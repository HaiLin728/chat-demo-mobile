#!/usr/bin/env python3
"""从一张源图生成 Android / iOS 的全套应用图标和启动图。

源图要求：正方形、纯色（或接近纯色）背景、深色主体。脚本会把背景抠成透明，
再按各平台的尺寸和安全区重新排版。

用法：
    python scripts/generate-icons.py --source path/to/icon.png
"""

import argparse
import os
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
ANDROID_RES = ROOT / "android" / "app" / "src" / "main" / "res"
IOS_RES = ROOT / "ios" / "App" / "App" / "Assets.xcassets"
DOCS = ROOT / "docs"

ANDROID_ICON_SIZES = {
    "mdpi": 48,
    "hdpi": 72,
    "xhdpi": 96,
    "xxhdpi": 144,
    "xxxhdpi": 192,
}

# 自适应图标前景是 108dp 画布，系统只会露出中间约 72dp，主体控制在 60dp 内
ANDROID_FOREGROUND_SIZES = {
    "mdpi": 108,
    "hdpi": 162,
    "xhdpi": 216,
    "xxhdpi": 324,
    "xxxhdpi": 432,
}

SPLASH_SIZES = {
    "drawable": (480, 320),
    "drawable-land-mdpi": (480, 320),
    "drawable-land-hdpi": (800, 480),
    "drawable-land-xhdpi": (1280, 720),
    "drawable-land-xxhdpi": (1600, 960),
    "drawable-land-xxxhdpi": (1920, 1280),
    "drawable-port-mdpi": (320, 480),
    "drawable-port-hdpi": (480, 800),
    "drawable-port-xhdpi": (720, 1280),
    "drawable-port-xxhdpi": (960, 1600),
    "drawable-port-xxxhdpi": (1280, 1920),
}


def parse_color(value: str) -> tuple[int, int, int]:
    value = value.strip().lstrip("#")
    return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4))


def key_out_background(image: Image.Image, bg_lum: float, fg_lum: float) -> Image.Image:
    """按亮度把浅色背景转成 alpha，主体用统一的前景色，保留抗锯齿边缘。"""
    lum = image.convert("L")
    scale = 255.0 / max(1.0, bg_lum - fg_lum)

    def alpha_at(value: int) -> int:
        alpha = (bg_lum - value) * scale
        # 源图背景有轻微渐变和噪点，低于阈值的部分直接当作透明
        return 0 if alpha < 24 else min(255, round(alpha))

    alpha = lum.point(alpha_at)
    solid = Image.new("RGBA", image.size, (0, 0, 0, 255))
    solid.putalpha(alpha)
    return solid


def fit_mark(mark: Image.Image, canvas: tuple[int, int], coverage: float) -> Image.Image:
    """把主体按宽度占比缩放后放到画布中央。"""
    width, height = canvas
    target_w = max(1, round(width * coverage))
    ratio = target_w / mark.width
    resized = mark.resize((target_w, max(1, round(mark.height * ratio))), Image.LANCZOS)
    result = Image.new("RGBA", canvas, (0, 0, 0, 0))
    result.alpha_composite(
        resized, ((width - resized.width) // 2, (height - resized.height) // 2)
    )
    return result


def rounded_mask(size: tuple[int, int], radius_ratio: float) -> Image.Image:
    scale = 4
    big = Image.new("L", (size[0] * scale, size[1] * scale), 0)
    draw = ImageDraw.Draw(big)
    radius = round(min(size) * radius_ratio * scale)
    draw.rounded_rectangle((0, 0, size[0] * scale - 1, size[1] * scale - 1), radius, fill=255)
    return big.resize(size, Image.LANCZOS)


def circle_mask(size: tuple[int, int]) -> Image.Image:
    scale = 4
    big = Image.new("L", (size[0] * scale, size[1] * scale), 0)
    draw = ImageDraw.Draw(big)
    draw.ellipse((0, 0, size[0] * scale - 1, size[1] * scale - 1), fill=255)
    return big.resize(size, Image.LANCZOS)


def compose_icon(
    mark: Image.Image,
    size: int,
    bg: tuple[int, int, int],
    coverage: float,
    mask: Image.Image | None = None,
) -> Image.Image:
    square = Image.new("RGBA", (size, size), (*bg, 255))
    square.alpha_composite(fit_mark(mark, (size, size), coverage))
    if mask is not None:
        square.putalpha(mask)
    return square


def save_png(image: Image.Image, path: Path, keep_alpha: bool = True) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, "PNG", optimize=True)
    print(f"  {path.relative_to(ROOT)}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, help="源图标路径")
    parser.add_argument("--background", default=None, help="图标背景色，默认取源图四角均值")
    parser.add_argument("--foreground", default="#1a2730", help="主体前景色")
    args = parser.parse_args()

    source = Image.open(args.source).convert("RGB")
    if source.width != source.height:
        raise SystemExit("源图必须是正方形")

    corners = [
        source.getpixel((0, 0)),
        source.getpixel((source.width - 1, 0)),
        source.getpixel((0, source.height - 1)),
        source.getpixel((source.width - 1, source.height - 1)),
    ]
    bg = parse_color(args.background) if args.background else tuple(
        sum(c[i] for c in corners) // len(corners) for i in range(3)
    )
    fg = parse_color(args.foreground)
    bg_lum = sum(bg) / 3
    fg_lum = sum(fg) / 3

    mark = key_out_background(source, bg_lum, fg_lum)
    bbox = mark.getchannel("A").point(lambda v: 255 if v > 24 else 0).getbbox()
    if bbox is None:
        raise SystemExit("没有找到深色主体，检查源图或 --foreground")
    pad = max(2, round(min(mark.size) * 0.01))
    mark = mark.crop(
        (
            max(0, bbox[0] - pad),
            max(0, bbox[1] - pad),
            min(mark.width, bbox[2] + pad),
            min(mark.height, bbox[3] + pad),
        )
    )
    print(f"主体裁切：{mark.width}x{mark.height}，背景 {bg}，前景 {fg}")

    # Android 传统图标 + 圆形图标
    print("Android 图标")
    for density, size in ANDROID_ICON_SIZES.items():
        out = ANDROID_RES / f"mipmap-{density}"
        icon = compose_icon(mark, size, bg, 0.80, rounded_mask((size, size), 0.20))
        save_png(icon, out / "ic_launcher.png")
        save_png(compose_icon(mark, size, bg, 0.78, circle_mask((size, size))), out / "ic_launcher_round.png")
        # 自适应图标前景：透明底，主体控制在安全区内
        foreground_size = ANDROID_FOREGROUND_SIZES[density]
        save_png(fit_mark(mark, (foreground_size, foreground_size), 0.58), out / "ic_launcher_foreground.png")

    # 自适应图标背景色
    background_xml = ANDROID_RES / "values" / "ic_launcher_background.xml"
    background_xml.write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n'
        "<resources>\n"
        f'    <color name="ic_launcher_background">#{bg[0]:02x}{bg[1]:02x}{bg[2]:02x}</color>\n'
        "</resources>\n",
        encoding="utf-8",
    )
    print(f"  {background_xml.relative_to(ROOT)}")

    # Android 启动图
    print("Android 启动图")
    for folder, (width, height) in SPLASH_SIZES.items():
        canvas = Image.new("RGBA", (width, height), (*bg, 255))
        canvas.alpha_composite(fit_mark(mark, (width, height), 0.38))
        save_png(canvas, ANDROID_RES / folder / "splash.png", keep_alpha=False)

    # iOS 图标（1024 不透明）与启动图
    print("iOS 图标与启动图")
    ios_icon = compose_icon(mark, 1024, bg, 0.72).convert("RGB")
    save_png(ios_icon, IOS_RES / "AppIcon.appiconset" / "AppIcon-512@2x.png", keep_alpha=False)
    for index in ("1", "2", ""):
        splash = Image.new("RGBA", (2732, 2732), (*bg, 255))
        splash.alpha_composite(fit_mark(mark, (2732, 2732), 0.25))
        name = f"splash-2732x2732{'-' + index if index else ''}.png"
        save_png(splash, IOS_RES / "Splash.imageset" / name, keep_alpha=False)

    # 文档预览图：1024 图标 + 圆形/圆角预览
    print("预览图")
    preview = Image.new("RGBA", (1240, 560), (255, 255, 255, 255))
    preview.alpha_composite(compose_icon(mark, 480, bg, 0.80), (40, 40))
    preview.alpha_composite(
        compose_icon(mark, 240, bg, 0.78, circle_mask((240, 240))), (580, 160)
    )
    preview.alpha_composite(
        compose_icon(mark, 240, bg, 0.80, rounded_mask((240, 240), 0.22)), (880, 160)
    )
    save_png(preview, DOCS / "icon-preview.png", keep_alpha=False)


if __name__ == "__main__":
    main()
