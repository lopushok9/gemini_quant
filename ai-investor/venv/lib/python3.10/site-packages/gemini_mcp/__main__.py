#!/usr/bin/env python3
"""
Gemini MCP 主入口点
支持通过 python -m gemini_mcp 或 gemini-mcp 命令运行
"""

import os
import sys
import argparse
from pathlib import Path
from dotenv import load_dotenv

# 加载环境变量
load_dotenv()

def main():
    """主函数"""
    parser = argparse.ArgumentParser(
        description="Gemini MCP Server - AI图片处理服务",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
环境变量:
  GEMINI_API_KEY    Gemini API密钥 (必需)
  OUTPUT_DIR        输出目录 (默认: ./outputs)
  
使用示例:
  # 使用环境变量
  export GEMINI_API_KEY=your-api-key
  gemini-mcp
  
  # 直接指定API密钥
  GEMINI_API_KEY=your-api-key gemini-mcp
  
  # 使用 uvx 运行（无需安装）
  GEMINI_API_KEY=your-api-key uvx gemini-mcp
        """
    )
    
    parser.add_argument(
        '--mode',
        choices=['stdio', 'http'],
        default='stdio',
        help='运行模式: stdio (默认) 或 http'
    )
    
    parser.add_argument(
        '--port',
        type=int,
        default=8080,
        help='HTTP模式端口 (默认: 8080)'
    )
    
    parser.add_argument(
        '--host',
        default='localhost',
        help='HTTP模式主机 (默认: localhost)'
    )
    
    parser.add_argument(
        '--debug',
        action='store_true',
        help='启用调试模式'
    )
    
    args = parser.parse_args()
    
    # 检查API密钥
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        print("❌ 错误: 未设置 GEMINI_API_KEY 环境变量", file=sys.stderr)
        print("\n请设置环境变量后重试:", file=sys.stderr)
        print("  export GEMINI_API_KEY=your-api-key", file=sys.stderr)
        print("  gemini-mcp", file=sys.stderr)
        print("\n或直接运行:", file=sys.stderr)
        print("  GEMINI_API_KEY=your-api-key gemini-mcp", file=sys.stderr)
        sys.exit(1)
    
    # 导入MCP服务器
    if args.debug:
        from .mcp_server_debug import mcp
        print("✅ Gemini MCP Server (调试模式) 已启动", file=sys.stderr)
    else:
        from .mcp_server import mcp
        print("✅ Gemini MCP Server 已启动", file=sys.stderr)
    
    # 运行服务器
    if args.mode == 'http':
        print(f"📡 HTTP模式: http://{args.host}:{args.port}", file=sys.stderr)
        print("🔄 传输方式: Server-Sent Events (SSE)", file=sys.stderr)
        mcp.run(
            transport="sse",
            host=args.host,
            port=args.port
        )
    else:
        print("📡 STDIO模式: 标准输入/输出", file=sys.stderr)
        print("💡 提示: 适用于 Claude Desktop, Cursor 等本地客户端", file=sys.stderr)
        mcp.run(transport="stdio")

if __name__ == "__main__":
    main()