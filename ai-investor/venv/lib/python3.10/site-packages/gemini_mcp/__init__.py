"""
Gemini MCP - MCP server for Gemini AI image processing
"""

__version__ = "0.1.0"
__author__ = "Your Name"
__email__ = "your.email@example.com"

from .gemini_api import process_image_async, GeminiImageProcessor

# MCP server 只在有 fastmcp 时导入
try:
    from .mcp_server import mcp
    __all__ = [
        "process_image_async",
        "GeminiImageProcessor",
        "mcp",
    ]
except ImportError:
    # 如果没有安装 fastmcp，仍然可以使用基础 API
    __all__ = [
        "process_image_async",
        "GeminiImageProcessor",
    ]