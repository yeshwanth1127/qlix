"""Tests for shared xlsx renderer."""

from __future__ import annotations

from pathlib import Path

import pytest

from qlix.xlsx_render import coerce_rows, render_xlsx


def test_coerce_rows_list_of_lists() -> None:
    assert coerce_rows([["A", "B"], [1, 2]]) == [["A", "B"], [1, 2]]


def test_coerce_rows_list_of_dicts() -> None:
    rows = coerce_rows([{"name": "Ada", "score": 10}, {"name": "Bob", "score": 8}])
    assert rows == [["name", "score"], ["Ada", 10], ["Bob", 8]]


def test_coerce_rows_csv_string() -> None:
    assert coerce_rows("a,b\n1,2") == [["a", "b"], ["1", "2"]]


def test_render_xlsx_writes_file(tmp_path: Path) -> None:
    out = tmp_path / "sales.xlsx"
    ok, msg = render_xlsx(
        title="Sales",
        rows=[["Product", "Qty"], ["Widget", 3]],
        sheet_name="Q1",
        out=out,
    )
    assert ok is True
    assert out.is_file()
    assert out.suffix == ".xlsx"
    assert "Created spreadsheet" in msg


def test_render_xlsx_requires_rows(tmp_path: Path) -> None:
    ok, msg = render_xlsx(title="Empty", rows=[], sheet_name="Sheet1", out=tmp_path / "empty.xlsx")
    assert ok is False
    assert "rows is required" in msg
