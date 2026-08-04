import argparse

import uvicorn

from crefleai.worker.app import create_app


def main() -> None:
    parser = argparse.ArgumentParser(description="CrefleAI 추론 워커")
    parser.add_argument("--model-path", required=True)
    parser.add_argument("--model-id", required=True)
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--ctx", type=int, default=8192)
    args = parser.parse_args()

    app = create_app(args.model_path, args.model_id, args.ctx)
    uvicorn.run(app, host="127.0.0.1", port=args.port)


if __name__ == "__main__":
    main()
