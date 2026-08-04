class InvalidTokenError(Exception):
    """서명 불일치, allowlist 미등록, 폐기 등 모든 토큰 검증 실패."""
