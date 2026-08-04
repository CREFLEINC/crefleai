class APIError(Exception):
    """OpenAI 에러 형식으로 변환되는 API 예외."""

    def __init__(self, status_code: int, message: str, type_: str, code: str | None = None):
        super().__init__(message)
        self.status_code = status_code
        self.message = message
        self.type = type_
        self.code = code
