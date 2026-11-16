#!/usr/bin/env python3
"""Update all-time Hugging Face download counts in the GitHub profile README."""

import json
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

START = "<!-- HF_ALL_TIME_DOWNLOADS:START -->"
END = "<!-- HF_ALL_TIME_DOWNLOADS:END -->"

MODEL = ("Whittle-35B-A3B-DFlash2", "https://huggingface.co/biscet/Whittle-35B-A3B-DFlash2")
DATASETS = (
    ("DFlash-DeepSeek-TraceMix", "https://huggingface.co/datasets/biscet/DFlash-DeepSeek-TraceMix"),
    ("DFlash-ChatGPT-TraceMix-Lite", "https://huggingface.co/datasets/biscet/DFlash-ChatGPT-TraceMix-Lite"),
)


def fetch_all_time_downloads(kind: str, name: str) -> int:
    query = urlencode({"expand[]": "downloadsAllTime"})
    url = f"https://huggingface.co/api/{kind}/biscet/{name}?{query}"
    request = Request(url, headers={
        "Accept": "application/json",
        "User-Agent": "biscet-github-readme-stats/1.0",
    })

    for attempt in range(3):
        try:
            with urlopen(request, timeout=20) as response:
                payload = json.load(response)
            total = payload.get("downloadsAllTime")
            if type(total) is not int or total < 0:
                raise ValueError(f"Missing/invalid downloadsAllTime for {kind}/biscet/{name}: {payload}")
            return total
        except (HTTPError, URLError, TimeoutError):
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)

    raise RuntimeError(f"Unable to retrieve downloads for {kind}/{name}")


def linked_count(name: str, url: str, total: int) -> str:
    unit = "download" if total == 1 else "downloads"
    return f"[{name}]({url}) ({total:,} {unit})"


def main() -> None:
    readme = Path("README.md")
    original = readme.read_text(encoding="utf-8")
    if original.count(START) != 1 or original.count(END) != 1:
        raise ValueError("Expected exactly one HF download statistics block in README.md")
    if original.index(START) >= original.index(END):
        raise ValueError("HF download statistics markers are out of order")

    model_count = fetch_all_time_downloads("models", MODEL[0])
    dataset_counts = [
        fetch_all_time_downloads("datasets", name)
        for name, _ in DATASETS
    ]

    block = "\n".join([
        START,
        f"- **Model:** {linked_count(*MODEL, model_count)}.",
        "- **Datasets:** "
        + " · ".join(
            linked_count(name, url, count)
            for (name, url), count in zip(DATASETS, dataset_counts)
        )
        + ".",
        END,
    ])

    before, remainder = original.split(START, 1)
    _, after = remainder.split(END, 1)
    updated = before + block + after

    if updated != original:
        readme.write_text(updated, encoding="utf-8")
        print("README download statistics updated")
    else:
        print("README download statistics unchanged")

    print(f"Model: {model_count:,} all-time downloads")
    for (name, _), count in zip(DATASETS, dataset_counts):
        print(f"{name}: {count:,} all-time downloads")


if __name__ == "__main__":
    main()
