from PIL import Image, ImageDraw, ImageFont
import os

def create_banner():
    # settings
    width = 1500
    height = 500
    bg_color = (20, 20, 20) # Almost black
    text_color = (255, 255, 255)
    text_content = "Quanty"
    logo_path = "/Users/yuriytsygankov/Documents/gemini assistant/assets/logofinal.png"
    output_path = "/Users/yuriytsygankov/Documents/gemini assistant/assets/banner_quanty.png"
    font_path = "/System/Library/Fonts/Supplemental/Arial.ttf"

    # Create image
    img = Image.new('RGB', (width, height), color=bg_color)
    draw = ImageDraw.Draw(img)

    # Load logo
    try:
        if not os.path.exists(logo_path):
            print(f"Logo not found at {logo_path}")
            return
        logo = Image.open(logo_path).convert("RGBA")
    except Exception as e:
        print(f"Error loading logo: {e}")
        return

    # Resize logo to fit nicely on the right side
    # Let's say logo takes up 80% of height, placed on the right
    logo_h = int(height * 0.8)
    aspect_ratio = logo.width / logo.height
    logo_w = int(logo_h * aspect_ratio)
    
    logo = logo.resize((logo_w, logo_h), Image.Resampling.LANCZOS)

    # Position logo: Vertically centered, Horizontally on the right with some padding
    # Padding right = 5% of width
    padding_right = int(width * 0.05)
    logo_x = width - logo_w - padding_right
    logo_y = (height - logo_h) // 2
    
    # Paste logo (using itself as mask for transparency)
    img.paste(logo, (logo_x, logo_y), logo)

    # Draw Text
    # We want text to be roughly centered in the remaining space or absolute center?
    # "посередине" usually means absolute center.
    # But if logo is huge, absolute center might overlap or look off.
    # Visual center of the "content area" (left of logo) vs Absolute Center.
    # Given the request "logo on right, text in middle", likely Absolute Center or Center of free space.
    # I'll aim for Absolute Center first, check for overlap.
    
    # Font size
    font_size = 200 # start big
    try:
        font = ImageFont.truetype(font_path, font_size)
    except:
        font = ImageFont.load_default()
    
    # Measure text
    bbox = draw.textbbox((0, 0), text_content, font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]
    
    # Adjust font size if too big
    max_text_w = width * 0.5 # Text shouldn't take more than half the width to avoid hitting logo
    if text_w > max_text_w:
        scale = max_text_w / text_w
        font_size = int(font_size * scale)
        font = ImageFont.truetype(font_path, font_size)
        bbox = draw.textbbox((0, 0), text_content, font=font)
        text_w = bbox[2] - bbox[0]
        text_h = bbox[3] - bbox[1]

    # Center text
    text_x = (width - text_w) // 2
    # If logo occupies that space, shift left?
    # Logo starts at logo_x.
    # If text_x + text_w > logo_x: Shift left.
    if text_x + text_w > logo_x - 20:
        # Center in the space remaining? 0 to logo_x
        text_x = (logo_x - text_w) // 2

    text_y = (height - text_h) // 2 - (bbox[1] // 2) + 20 # approximate vertical center correction

    draw.text((text_x, text_y), text_content, font=font, fill=text_color)

    # Save
    img.save(output_path)
    print(f"Banner saved to {os.path.abspath(output_path)}")

if __name__ == "__main__":
    create_banner()
