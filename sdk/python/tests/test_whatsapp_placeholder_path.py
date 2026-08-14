from qlix.cloud_whatsapp_runtime import is_placeholder_file_path


def test_placeholder_paths():
    assert is_placeholder_file_path("path/to/brochure.pdf")
    assert is_placeholder_file_path("/path/to/excel_sheet.xlsx")
    assert is_placeholder_file_path("brochure.pdf")
    assert not is_placeholder_file_path("/tmp/real-brochure.pdf")
