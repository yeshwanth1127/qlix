"""Read-only file intent detection for hybrid tool routing."""

from qlix.agents3_runtime import is_read_only_file_intent


def test_field_support_prompt_is_read_only():
    prompt = (
        "Follow our field support playbook. On my PC read "
        r"C:\Users\admin\source\repos\autocad-final\autocad-final\bin\Debug\AgentDebug.log, "
        "open it on my screen in Notepad, list the last 5 error lines, then summarize for me here."
    )
    assert is_read_only_file_intent(prompt)


def test_write_request_is_not_read_only():
    assert not is_read_only_file_intent("read the log and save a copy to error_summary.txt")


def test_save_keyword_blocks_read_only():
    assert not is_read_only_file_intent("open the log and write results to report.txt")
