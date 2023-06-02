#!/srv/coldfront/venv/bin/python3
import json
import requests
import configparser
from datetime import datetime
import argparse
import xml.etree.ElementTree as E

import os
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "coldfront.config.settings")
import django
django.setup()
from coldfront.core.resource.models import Resource

parser = argparse.ArgumentParser(
    prog="storage.py",
    description="XDMoD Storage Scraper: Takes Coldfront allocations and scrapes storage platforms for XDMoD ingestion.",
    formatter_class=argparse.ArgumentDefaultsHelpFormatter)
parser.add_argument("-c", "--config", help="ini file to use instead of CLI args")
parser.add_argument("-i", "--input-directory", help="Uses JSON files instead of API queries for debugging. Set to a directory that contains the neccesary json files | ex: ./debug/ (Files needed: coldfront.json, vast.json AND / OR panasas.json)")
parser.add_argument("-d", "--debug-output", help="Creates JSON debug files from API data | ex: ./debug/")
parser.add_argument("-o", "--output-directory", default="./", help="Output directory for XDMoD ingest files | ex: ./output/")
parser.add_argument("-r", "--resources", default="ProjectStorage", help="Name of storage Coldfront resources (comma separated) | ex: ProjectStorage,Global Scratch,ProjectArchive)")

parser.add_argument("--vast-url", help="Vast API URL (ex: 10.0.0.1 (exclude https:// or /api/quotas/))")
parser.add_argument("--vast-username", help="Vast API username")
parser.add_argument("--vast-password", help="Vast API password")

parser.add_argument("--panasas-url", help="Panasas API URL (ex: 10.0.0.1:10635 (exclude https:// or /pasxml))")
parser.add_argument("--panasas-username", help="Panasas API username")
parser.add_argument("--panasas-password", help="Panasas API password")

args = parser.parse_args()

if args.config != None:
    config_file = configparser.ConfigParser()
    config_file.read(args.config)
    defaults = {}
    defaults.update(config_file["default"])
    parser.set_defaults(**defaults)
    args = parser.parse_args()

def panasas_convert_GB(input):
    return int(float(input) * (1024 ** 3))
def panasas_xml_volumes_to_list(input):
    tree = E.fromstring(input)
    volumes = tree.findall("./volumes/volume")
    output=[]
    for volume in volumes:
        children = {}
        for element in volume:
            children[element.tag] = element.text
        output.append(children)
    return output

if args.input_directory == None or args.debug_output != None:
    # *** Coldfront ***
    coldfront_data = {}
    for resource_name in args.resources.split(","):
        ps = Resource.objects.get(name=resource_name)

        for allocation in ps.allocation_set.filter(status__name__in=['Active']):
            pi_user = allocation.project.pi.username
            path_attr = allocation.get_attribute('Storage directory name') or ''
            if path_attr != "" and pi_user != "":
                # All allocations are under the PI, so the user will always be the PI
                coldfront_data[path_attr] = {"pi": pi_user, "user": pi_user}

    # *** Vast ***
    vast_data = []
    if args.vast_url != None and args.vast_username != None and args.vast_password != None:
        url = args.vast_url
        vast_username = args.vast_username
        vast_password = args.vast_password

        uri = "https://" + url + "/api/quotas/"
        vast_res = requests.get(url, auth=(vast_username, vast_password), verify=False)
        vast_data = vast_res.json()
    else:
        print("Failed to get Vast data, invalid connection options specified")

    # *** Panasas ***
    panasas_data = []
    if args.panasas_url != None and args.panasas_username != None and args.panasas_password != None:
        url = "https://" + args.panasas_url + "/pasxml"
        panasas_username = args.panasas_username
        panasas_password = args.panasas_password

        uri = url + "/login"
        payload = { "name": panasas_username, "pass": panasas_password }
        panasas_login_res = requests.get(uri, params=payload, verify=False)
        panasas_cookie = panasas_login_res.cookies

        uri = url + "/volumes"
        panasas_data_res = requests.get(uri, cookies=panasas_cookie, verify=False)
        panasas_data = panasas_xml_volumes_to_list(panasas_data_res.content)

        uri = url + "/logout"
        panasas_logout_res = requests.get(uri, cookies=panasas_cookie, verify=False)
    else:
        print("Failed to get Panasas data, invalid connection options specified")

else:
    with open(args.input_directory + "coldfront.json") as f:
        coldfront_data = json.load(f)
    try:
        with open(args.input_directory + "vast.json") as f:
            vast_data = json.load(f)
    except FileNotFoundError:
        print("Vast file not found, skipping Vast data.")
        vast_data = []
    try:
        with open(args.input_directory + "panasas.json") as f:
            panasas_data = json.load(f)
    except FileNotFoundError:
        print("Panasas file not found, skipping Panasas data.")
        panasas_data = []


if args.debug_output != None:
    with open(args.debug_output + "coldfront.json", 'w', encoding='utf-8') as f:
        json.dump(coldfront_data, f, ensure_ascii=False, indent=2)
    if len(vast_data) != 0:
        with open(args.debug_output + "vast.json", 'w', encoding='utf-8') as f:
            json.dump(vast_data, f, ensure_ascii=False, indent=2)
    else:
        print("Vast data is empty, skipping debug output.")
    if len(panasas_data) != 0:
        with open(args.debug_output + "panasas.json", 'w', encoding='utf-8') as f:
            json.dump(panasas_data, f, ensure_ascii=False, indent=2)
    else:
        print("Panasas data is empty, skipping debug output.")

data = []
for allocation in coldfront_data:
    vast_quota = next(filter(lambda x: x["path"] == allocation, vast_data), None)
    panasas_quota = next(filter(lambda x: ("/panasas" + x["name"]) == allocation, panasas_data), None) # The full path on Coldfront is /panasas/<panasas_volume_name>

    if vast_quota != None:
        data.append({
            "resource": "vast",
            "mountpoint": "/" + vast_quota["path"].split("/")[1],
            "pi": coldfront_data[allocation]["pi"] or "Unknown",
            "user": coldfront_data[allocation]["user"] or "Unknown",
            "dt": datetime.now().strftime("%Y-%m-%dT%H:%M:%SZ"),
            "soft_threshold": vast_quota["soft_limit"],
            "hard_threshold": vast_quota["hard_limit"],
            "file_count": vast_quota["used_inodes"],
            "logical_usage": vast_quota["used_effective_capacity"],
            "physical_usage": vast_quota["used_capacity"],
        })
    elif panasas_quota != None:
        data.append({
            "resource": "panasas",
            "mountpoint": "/" + panasas_quota["name"].split("/")[1],
            "pi": coldfront_data[allocation]["pi"] or "Unknown",
            "user": coldfront_data[allocation]["user"] or "Unknown",
            "dt": datetime.now().strftime("%Y-%m-%dT%H:%M:%SZ"),
            "soft_threshold": panasas_convert_GB(panasas_quota["softQuotaGB"]),
            "hard_threshold": panasas_convert_GB(panasas_quota["hardQuotaGB"]),
            "file_count": 0, # Panasas does not report these metrics
            "logical_usage": panasas_convert_GB(panasas_quota["spaceUsedGB"]),
            "physical_usage": 0, # Panasas does not report these metrics
        })
    else:
        print("Failed to match directory: " + allocation)
        continue

if len(data) != 0:
    output_filename = args.output_directory + datetime.now().strftime("%Y-%m-%d") + ".json"
    with open(output_filename, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print("\nSuccessfully output file: '" + output_filename + "' with " + str(len(data)) + " entries.\n")
else:
    print("\nOutput list is empty, skipping file creation.\n")