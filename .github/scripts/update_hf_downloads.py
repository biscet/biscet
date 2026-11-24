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
OBORO_START = "<!-- OBORO_ALL_TIME_DOWNLOADS:START -->"
OBORO_END = "<!-- OBORO_ALL_TIME_DOWNLOADS:END -->"
TOTAL_START = "<!-- HF_TOTAL_DOWNLOADS:START -->"
TOTAL_END = "<!-- HF_TOTAL_DOWNLOADS:END -->"

MODELS = (
    ("Whittle-35B-A3B-DFlash2", "https://huggingface.co/biscet/Whittle-35B-A3B-DFlash2"),
    ("Whittle-35B-A3B-Vision", "https://huggingface.co/biscet/Whittle-35B-A3B-Vision"),
)
OBORO_MODEL = ("Oboro-Blink-1.0", "https://huggingface.co/oboro-ai/Oboro-Blink-1.0")
DATASETS = (
    ("DFlash-DeepSeek-TraceMix", "https://huggingface.co/datasets/biscet/DFlash-DeepSeek-TraceMix"),
    ("DFlash-ChatGPT-TraceMix-Lite", "https://huggingface.co/datasets/biscet/DFlash-ChatGPT-TraceMix-Lite"),
    ("SonicRank-ChatGPT-10K", "https://huggingface.co/datasets/biscet/SonicRank-ChatGPT-10K"),
)


def fetch_all_time_downloads(kind: str, name: str, owner: str = "biscet") -> int:
    query = urlencode({"expand[]": "downloadsAllTime"})
    url = f"https://huggingface.co/api/{kind}/{owner}/{name}?{query}"
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
                raise ValueError(f"Missing/invalid downloadsAllTime for {kind}/{owner}/{name}: {payload}")
            return total
        except (HTTPError, URLError, TimeoutError):
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)

    raise RuntimeError(f"Unable to retrieve downloads for {kind}/{name}")


def linked_count(name: str, url: str, total: int) -> str:
    unit = "download" if total == 1 else "downloads"
    return f"[{name}]({url}) ({total:,} {unit})"


def replace_stats_block(readme: str, start: str, end: str, lines: list[str]) -> str:
    """Replace one marked statistics block, preserving the rest of the README."""
    if readme.count(start) != 1 or readme.count(end) != 1:
        raise ValueError(f"Expected exactly one download statistics block: {start}")
    if readme.index(start) >= readme.index(end):
        raise ValueError(f"Download statistics markers are out of order: {start}")

    before, remainder = readme.split(start, 1)
    _, after = remainder.split(end, 1)
    block = "\n".join([start, *lines, end])
    return before + block + after


def main() -> None:
    readme = Path("README.md")
    original = readme.read_text(encoding="utf-8")

    model_counts = [
        fetch_all_time_downloads("models", name)
        for name, _ in MODELS
    ]
    dataset_counts = [
        fetch_all_time_downloads("datasets", name)
        for name, _ in DATASETS
    ]
    oboro_count = fetch_all_time_downloads("models", OBORO_MODEL[0], owner="oboro-ai")
    total_downloads = sum(model_counts) + sum(dataset_counts) + oboro_count

    updated = replace_stats_block(original, START, END, [
        "- **Models:** "
        + " · ".join(
            linked_count(name, url, count)
            for (name, url), count in zip(MODELS, model_counts)
        )
        + ".",
        "- **Datasets:** "
        + " · ".join(
            linked_count(name, url, count)
            for (name, url), count in zip(DATASETS, dataset_counts)
        )
        + ".",
    ])
    updated = replace_stats_block(updated, OBORO_START, OBORO_END, [
        f"- **Model:** {linked_count(*OBORO_MODEL, oboro_count)}.",
    ])
    updated = replace_stats_block(updated, TOTAL_START, TOTAL_END, [
        (
            f"**Total model & dataset downloads: {total_downloads:,} all-time** "
            "across [biscet](https://huggingface.co/biscet) "
            "and [Oboro AI](https://huggingface.co/oboro-ai)."
        ),
    ])

    if updated != original:
        readme.write_text(updated, encoding="utf-8")
        print("README download statistics updated")
    else:
        print("README download statistics unchanged")

    for (name, _), count in zip(MODELS, model_counts):
        print(f"{name}: {count:,} all-time downloads")
    for (name, _), count in zip(DATASETS, dataset_counts):
        print(f"{name}: {count:,} all-time downloads")
    print(f"{OBORO_MODEL[0]}: {oboro_count:,} all-time downloads")
    print(f"Total models & datasets: {total_downloads:,} all-time downloads")


if __name__ == "__main__":
    main()

