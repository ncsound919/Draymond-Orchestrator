"""LLMLingua-2 prompt compressor wrapper for Draymond.

Usage:
  python compress.py --text "<prompt>" --rate 0.5 [--question "task"] [--target 200]

Reads text from stdin or --text. Prints JSON: {original_tokens, compressed_tokens, ratio, compressed_prompt}.
Uses LLMLingua-2 BERT-base on CPU (lightweight, fits this laptop).
"""
import argparse
import json
import sys
import os

# Force CPU (no CUDA on this laptop)
os.environ["CUDA_VISIBLE_DEVICES"] = ""

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--text", default=None)
    parser.add_argument("--rate", type=float, default=0.5, help="Compression ratio (0-1, lower = more compressed)")
    parser.add_argument("--question", default="")
    parser.add_argument("--target", type=int, default=0, help="Target token count (overrides rate if >0)")
    args = parser.parse_args()

    text = args.text
    if not text and not sys.stdin.isatty():
        text = sys.stdin.read()
    if not text:
        print(json.dumps({"error": "no text provided"}))
        sys.exit(1)

    from llmlingua import PromptCompressor

    llm_lingua = PromptCompressor(
        model_name="microsoft/llmlingua-2-bert-base-multilingual-cased-meetingbank",
        use_llmlingua2=True,
        device_map="cpu",
    )
    if args.target > 0:
        r = llm_lingua.compress_prompt(
            text, instruction="", question=args.question, target_token=args.target
        )
    else:
        r = llm_lingua.compress_prompt(
            text, instruction="", question=args.question, rate=args.rate
        )

    print(json.dumps({
        "original_tokens": r.get("origin_tokens"),
        "compressed_tokens": r.get("compressed_tokens"),
        "ratio": r.get("ratio"),
        "compressed_prompt": r["compressed_prompt"],
    }))

if __name__ == "__main__":
    main()
