from qlix.runner_common import format_datetime_context


def test_format_datetime_context_includes_relative_date_hint() -> None:
    text = format_datetime_context(timezone_name="Asia/Kolkata")
    assert "Current date and time:" in text
    assert "today" in text.lower()


def test_format_datetime_context_adds_crm_coql_hint() -> None:
    text = format_datetime_context(
        timezone_name="Asia/Kolkata",
        granted_scopes={"crm.read", "crm.write"},
    )
    assert "COQL" in text
    assert "Created_Time" in text
    assert "+05:30" in text
