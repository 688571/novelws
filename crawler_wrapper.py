import sys
import os

# Ensure vendor directory is in sys.path as an absolute path
current_dir = os.path.dirname(os.path.abspath(__file__))
vendor_dir = os.path.join(current_dir, 'vendor')
if vendor_dir not in sys.path:
    sys.path.insert(0, vendor_dir)

# Also try process working directory vendor
cwd_vendor = os.path.join(os.getcwd(), 'vendor')
if cwd_vendor not in sys.path:
    sys.path.insert(0, cwd_vendor)

import json
import logging
from crawler import run_crawler

def main():
    config = json.loads(sys.stdin.read())
    url = config.get("url")
    output_dir = config.get("output_dir", "./novels")
    override_name = config.get("override_name")
    existing_hashes = set(config.get("existing_hashes", []))

    def log_cb(msg):
        print(json.dumps({"type": "log", "msg": msg}), flush=True)

    try:
        novel_name, txt_path, chapter_hashes = run_crawler(
            start_url=url,
            output_dir=output_dir,
            log_callback=log_cb,
            override_name=override_name,
            existing_chapter_hashes=existing_hashes if existing_hashes else None
        )
        print(json.dumps({
            "type": "result",
            "novel_name": novel_name,
            "txt_path": txt_path,
            "html_path": None,
            "success": True,
            "chapter_hashes": chapter_hashes or []
        }), flush=True)
    except Exception as e:
        print(json.dumps({"type": "error", "error": str(e)}), flush=True)

if __name__ == "__main__":
    main()
