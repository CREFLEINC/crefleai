def test_토큰_저장_조회_폐기(db):
    db.insert_token("jti-1", "홍길동", "테스트", "2026-08-03T00:00:00+00:00")
    row = db.get_token("jti-1")
    assert row["user_name"] == "홍길동"
    assert row["purpose"] == "테스트"
    assert row["revoked_at"] is None

    assert db.revoke_token("jti-1", "2026-08-04T00:00:00+00:00") is True
    assert db.get_token("jti-1")["revoked_at"] is not None
    assert db.revoke_token("없는-jti", "2026-08-04T00:00:00+00:00") is False

    assert [r["jti"] for r in db.list_tokens()] == ["jti-1"]
    assert db.get_token("없는-jti") is None


def test_관리자_계정(db):
    assert db.count_admins() == 0
    db.create_admin("admin", "해시값", "2026-08-03T00:00:00+00:00")
    assert db.count_admins() == 1
    assert db.get_admin("admin")["password_hash"] == "해시값"
    assert db.get_admin("없는계정") is None


def test_설정_upsert(db):
    assert db.get_setting("serving_model") is None
    db.set_setting("serving_model", "model-a")
    db.set_setting("serving_model", "model-b")
    assert db.get_setting("serving_model") == "model-b"
