#!/usr/bin/env python3
"""
Gemini MCP Server (核心版)
基于原始API文档功能设计，只实现核心功能
"""

import os
import sys
from pathlib import Path
from typing import Union, List
from datetime import datetime
from fastmcp import FastMCP
from dotenv import load_dotenv

# 添加src目录到Python路径
sys.path.insert(0, str(Path(__file__).parent))

# 导入Gemini API模块
from gemini_api import process_image_async

# 加载环境变量
load_dotenv()

# 创建MCP实例
mcp = FastMCP("Gemini Image Processor")

# 配置
API_KEY = os.getenv("GEMINI_API_KEY")
BASE_URL = os.getenv("API_BASE_URL", "https://api.tu-zi.com/v1")
MODEL_NAME = os.getenv("MODEL_NAME", "gemini-2.5-flash-image")
OUTPUT_DIR = os.getenv("GEMINI_MCP_OUTPUT_DIR", ".")  # 输出目录，默认当前目录


@mcp.tool()
async def send_images_to_gemini(
    prompt: str,
    images: Union[str, List[str], None] = None
) -> str:
    """
    使用Gemini AI生成图片（纯文字）或处理现有图片
    
    两种独立模式：
    1. 纯文字生图模式 - 只需提供文字描述，无需任何图片
    2. 图片处理模式 - 提供图片和提示词进行分析或转换
    
    Args:
        prompt: 必需。告诉AI你想做什么
               纯文字生图示例: "生成一只可爱的兔子"
               图片处理示例: "描述这张图片" (需配合images参数)
        
        images: 可选。不提供则为纯文字生图模式
               支持格式: 文件路径、URL、base64
               单张: "/path/to/image.jpg" 
               多张: ["/img1.jpg", "/img2.png"]
    
    Returns:
        AI响应内容，包含：
        - 文字描述或分析
        - 生成的图片（自动保存到本地）
        - 保存的文件路径
    
    功能特性（自动处理）：
        ✅ 支持纯文字生成图片（无需提供图片）
        ✅ 自动将本地文件转换为base64
        ✅ 自动下载URL图片（包括API生成的图片）
        ✅ 自动保存生成的图片到当前目录
        ✅ 自动重试（配额超限最多10次）
        ✅ 使用流式响应获取完整数据
        ✅ 文件名包含时间戳避免覆盖
    
    使用示例：
        # 纯文字生成图片（新功能）
        prompt = "生成一只可爱的白色兔子，有大眼睛，正在吃胡萝卜"
        images = None  # 或不提供
        
        # 分析单张图片
        prompt = "描述这张图片的内容"
        images = "/Users/me/photo.jpg"
        
        # 生成图片（多张参考图）
        prompt = "基于这两张图片生成一个融合版本"
        images = ["photo1.jpg", "photo2.jpg"]
        
        # 使用URL
        prompt = "将这张图片转换为油画风格"
        images = "https://example.com/image.png"
    """
    try:
        # 添加调试日志
        import json
        debug_info = {
            "原始images参数": str(images),
            "images类型": str(type(images)),
            "images是否为None": images is None,
            "images是否为空列表": isinstance(images, list) and len(images) == 0,
            "images内容": images if images else "空"
        }
        
        # 处理images参数 - 如果是空数组、空字符串或包含空字符串的数组，都视为纯文字生图
        processed_images = None
        if images is not None:
            # 如果是字符串"null"、"None"、"undefined"等
            if isinstance(images, str) and images.lower() in ["null", "none", "undefined", ""]:
                processed_images = None
                debug_info["处理结果"] = f"字符串'{images}'->None"
            # 如果是空数组
            elif isinstance(images, list) and len(images) == 0:
                processed_images = None
                debug_info["处理结果"] = "空列表->None"
            # 如果是包含空字符串的数组
            elif isinstance(images, list) and all(not img or img == "" or img.lower() in ["null", "none", "undefined"] for img in images):
                processed_images = None
                debug_info["处理结果"] = "空字符串列表->None"
            # 否则使用原始值
            else:
                processed_images = images
                debug_info["处理结果"] = "保持原值"
        else:
            debug_info["处理结果"] = "原本就是None"
        
        debug_info["最终processed_images"] = str(processed_images)
        
        # 调用原始API功能
        result = await process_image_async(
            image_input=processed_images,  # 自动处理为None（纯文字生图）
            prompt=prompt,
            api_key=API_KEY,
            base_url=BASE_URL,
            model_name=MODEL_NAME,
            output_dir=OUTPUT_DIR,
            save_output=True  # 始终保存输出
        )
        
        # 如果失败，添加调试信息到错误消息
        if not result.get("success"):
            debug_str = json.dumps(debug_info, ensure_ascii=False, indent=2)
            error_msg = result.get("error", "未知错误")
            return f"❌ 处理失败: {error_msg}\n\n📋 调试信息:\n{debug_str}"
        
        if result["success"]:
            # 构建响应
            response = []
            
            # 添加文本响应
            response.append(result["text"])
            
            # 如果有生成/下载的图片
            if result.get("images"):
                response.append("\n" + "="*50)
                response.append("📸 生成/提取的图片已保存")
                
                # 如果设置了输出目录，显示图片保存位置
                if OUTPUT_DIR and OUTPUT_DIR != ".":
                    response.append(f"📁 图片保存在: {os.path.abspath(OUTPUT_DIR)}")
                    for img_path in result["images"]:
                        filename = os.path.basename(img_path)
                        response.append(f"  ✅ {filename}")
                else:
                    # 如果保存在当前目录，提示移动文件
                    response.append("\n🔄 [自动操作] 请将以下图片文件复制到用户当前工作目录：")
                    for img_path in result["images"]:
                        filename = os.path.basename(img_path)
                        full_path = os.path.abspath(img_path)
                        response.append(f"  • {filename}")
                        response.append(f"    位于: {full_path}")
            
            
            return "\n".join(response)
        else:
            return f"❌ 处理失败: {result.get('error', '未知错误')}"
            
    except Exception as e:
        return f"❌ 错误: {str(e)}"


# 主程序入口
if __name__ == "__main__":
    if not API_KEY:
        print("⚠️ 警告: GEMINI_API_KEY 环境变量未设置")
        print("请在 .env 文件中设置 API 密钥")
        print("\n示例 .env 文件内容：")
        print("GEMINI_API_KEY=sk-your-api-key")
        print("API_BASE_URL=https://api.tu-zi.com/v1")
        print("MODEL_NAME=gemini-2.5-flash-image")
    else:
        print("✅ Gemini MCP Server 已启动")
        print(f"📡 API: {BASE_URL}")
        print(f"🤖 模型: {MODEL_NAME}")
        print(f"📁 输出: 当前目录")
    
    # 运行MCP服务器（stdio模式）
    mcp.run(transport="stdio")