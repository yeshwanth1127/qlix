from qlix.tool_router import invoke_discovered_tool, normalize_discovered_tool_name


def test_strips_openai_function_prefixes() -> None:
    assert normalize_discovered_tool_name("functions.find_tools") == "find_tools"
    assert normalize_discovered_tool_name("tools.call_tool") == "call_tool"
    assert normalize_discovered_tool_name("crm_search") == "crm_search"


def test_call_tool_find_tools_without_query_hints_instead_of_unknown() -> None:
    result = invoke_discovered_tool(
        '{"name": "functions.find_tools"}',
        {"find_tools": lambda _args: "should not run"},
    )
    assert result.startswith("[hint]")
    assert "final answer" in result


def test_call_tool_find_tools_with_query_invokes_catalog() -> None:
    result = invoke_discovered_tool(
        '{"name": "functions.find_tools", "arguments": {"query": "crm"}}',
        {"find_tools": lambda args: f"catalog:{args}"},
    )
    assert "catalog:" in result
    assert "crm" in result


def test_call_tool_cannot_invoke_itself() -> None:
    result = invoke_discovered_tool('{"name": "functions.call_tool"}', {})
    assert result.startswith("[failed]")
    assert "cannot invoke itself" in result


def test_call_tool_rejects_permission_scope_names() -> None:
    result = invoke_discovered_tool('{"name": "crm.write"}', {})
    assert "permission scope" in result
    assert "crm.write" in result


def test_call_tool_resolves_real_executor() -> None:
    result = invoke_discovered_tool(
        '{"name": "crm_search", "arguments": {"query": "leads"}}',
        {"crm_search": lambda args: f"ok:{args}"},
    )
    assert result.startswith("ok:")
    assert "leads" in result
