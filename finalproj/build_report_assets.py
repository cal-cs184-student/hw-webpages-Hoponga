"""Build cropped and tiled images for the CS184 final report."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parent
IMAGES = ROOT / "images"
TEXT = (35, 35, 35)
MUTED = (82, 89, 101)
PANEL = (250, 250, 248)
LINE = (210, 214, 220)


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    """Load a system font with a small fallback for portability."""

    candidates = [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Supplemental/Helvetica Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Helvetica.ttf",
        "/Library/Fonts/Arial Bold.ttf" if bold else "/Library/Fonts/Arial.ttf",
    ]
    for candidate in candidates:
        try:
            return ImageFont.truetype(candidate, size)
        except OSError:
            continue
    return ImageFont.load_default()


def cover_resize(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    """Resize an image to cover a target rectangle, cropping the excess."""

    source_w, source_h = image.size
    target_w, target_h = size
    scale = max(target_w / source_w, target_h / source_h)
    resized = image.resize((round(source_w * scale), round(source_h * scale)), Image.Resampling.LANCZOS)
    left = max(0, (resized.width - target_w) // 2)
    top = max(0, (resized.height - target_h) // 2)
    return resized.crop((left, top, left + target_w, top + target_h))


def contain_resize(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    """Resize an image to fit inside a target rectangle."""

    image = image.copy()
    image.thumbnail(size, Image.Resampling.LANCZOS)
    return image


def draw_label(draw: ImageDraw.ImageDraw, xy: tuple[int, int], title: str, width: int) -> None:
    """Draw a compact panel label."""

    x, y = xy
    draw.text((x, y), title, fill=TEXT, font=font(24, bold=True))
    draw.line((x, y + 34, x + width, y + 34), fill=LINE, width=2)


def paste_panel(
    canvas: Image.Image,
    image: Image.Image,
    box: tuple[int, int, int, int],
    title: str,
    fit: str = "cover",
) -> None:
    """Paste one framed image panel with a short label."""

    x, y, w, h = box
    draw = ImageDraw.Draw(canvas)
    draw.rounded_rectangle((x - 1, y - 1, x + w + 1, y + h + 1), radius=8, fill=(235, 238, 243))
    draw.rounded_rectangle((x, y, x + w, y + h), radius=8, fill=PANEL)
    fitted = cover_resize(image, (w, h)) if fit == "cover" else contain_resize(image, (w, h))
    paste_x = x + (w - fitted.width) // 2
    paste_y = y + (h - fitted.height) // 2
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, w, h), radius=8, fill=255)
    if fit == "cover":
        canvas.paste(fitted, (x, y), mask)
    else:
        canvas.paste(fitted, (paste_x, paste_y))
    draw_label(draw, (x, y + h + 12), title, w)


def source_projection(path: str) -> Image.Image:
    """Crop the main 3D projection panel from a simulator frame."""

    image = Image.open(IMAGES / path).convert("RGB")
    return image.crop((330, 160, 1220, 940))


def source_slices(path: str) -> Image.Image:
    """Crop the orthogonal slice panels from a simulator frame."""

    image = Image.open(IMAGES / path).convert("RGB")
    return image.crop((1450, 270, 2890, 820))


def build_opening_result() -> None:
    """Create the large opening result image."""

    panel = source_projection("explosive_frame_0220.png")
    canvas = Image.new("RGB", (1320, 820), (8, 10, 14))
    result = cover_resize(panel, (1320, 820))
    canvas.paste(result, (0, 0))
    canvas.save(IMAGES / "opening_result.png", optimize=True)


def build_explosive_sequence() -> None:
    """Create a three-panel timeline of the explosive preset."""

    frames = [
        ("explosive_frame_0000.png", "Start"),
        ("explosive_frame_0112.png", "Middle"),
        ("explosive_frame_0220.png", "End"),
    ]
    canvas = Image.new("RGB", (1500, 500), (255, 255, 255))
    for index, (path, title) in enumerate(frames):
        x = 40 + index * 485
        paste_panel(canvas, source_projection(path), (x, 40, 450, 400), title)
    canvas.save(IMAGES / "explosive_sequence.png", optimize=True)


def build_milestone_2d_sequence() -> None:
    """Create a compact tile from the 2D baseline frames."""

    frames = [
        ("baseline_frame_0000.png", "step 0"),
        ("baseline_frame_0060.png", "step 60"),
        ("baseline_frame_0120.png", "step 120"),
        ("baseline_frame_0240.png", "step 240"),
    ]
    canvas = Image.new("RGB", (1500, 1160), (255, 255, 255))
    for index, (path, label) in enumerate(frames):
        image = Image.open(IMAGES / path).convert("RGB")
        x = 48 + (index % 2) * 730
        y = 40 + (index // 2) * 560
        paste_panel(canvas, image, (x, y, 680, 500), label)
    canvas.save(IMAGES / "milestone_2d_sequence.png", optimize=True)


def build_rendering_breakdown() -> None:
    """Create a tile showing projection and orthogonal slices."""

    projection = source_projection("explosive_frame_0220.png")
    slices = source_slices("explosive_frame_0220.png")
    canvas = Image.new("RGB", (1500, 560), (255, 255, 255))
    paste_panel(canvas, projection, (48, 40, 540, 430), "Final render")
    paste_panel(
        canvas,
        slices,
        (650, 80, 810, 300),
        "Grid slices",
    )
    canvas.save(IMAGES / "rendering_breakdown.png", optimize=True)


def build_physics_regions() -> None:
    """Create a simple labeled reduced-model schematic."""

    canvas = Image.new("RGB", (1280, 720), (255, 255, 255))
    draw = ImageDraw.Draw(canvas)
    center = (365, 395)

    rings = [
        (260, (245, 226, 132), "shock front"),
        (190, (252, 154, 86), "hot region"),
        (95, (159, 139, 208), "cooler center"),
        (46, (75, 57, 122), "dense core"),
    ]
    for radius, color, _ in rings:
        x0, y0 = center[0] - radius, center[1] - radius
        x1, y1 = center[0] + radius, center[1] + radius
        draw.ellipse((x0, y0, x1, y1), fill=color, outline=(255, 255, 255), width=5)

    plume_color = (236, 74, 82)
    for points in [
        [(375, 365), (465, 265), (575, 223), (533, 337), (460, 427)],
        [(345, 425), (255, 540), (165, 583), (243, 455), (305, 365)],
    ]:
        draw.polygon(points, fill=plume_color)
    draw.ellipse((319, 349, 411, 441), fill=(65, 52, 119), outline=(255, 255, 255), width=4)

    draw.line((595, 255, 780, 160), fill=plume_color, width=7)
    draw.line((780, 160, 746, 158), fill=plume_color, width=7)
    draw.line((780, 160, 760, 188), fill=plume_color, width=7)
    draw.text((804, 140), "hot plume", fill=TEXT, font=font(27, bold=True))

    legend_x = 760
    legend_y = 265
    for index, (_, color, label) in enumerate(rings):
        y = legend_y + index * 72
        draw.rounded_rectangle((legend_x, y, legend_x + 44, y + 44), radius=8, fill=color)
        draw.text((legend_x + 64, y + 6), label, fill=TEXT, font=font(25, bold=True))

    canvas.save(IMAGES / "physics_regions.png", optimize=True)


def build_viewer_grid() -> None:
    """Create a tiled figure from real browser viewer screenshots."""

    frames = [
        ("viewer_volume_04.png", "step 40"),
        ("viewer_volume_08.png", "step 72"),
        ("viewer_volume_12.png", "step 112"),
        ("viewer_volume_20.png", "step 184"),
    ]
    if any(not (IMAGES / path).exists() for path, _ in frames):
        return

    screenshots = []
    for path, label in frames:
        screenshot = Image.open(IMAGES / path).convert("RGB")
        screenshots.append((screenshot.crop((0, 0, 960, 760)), label))

    canvas = Image.new("RGB", (1500, 1160), (255, 255, 255))
    for index, (screenshot, label) in enumerate(screenshots):
        x = 48 + (index % 2) * 730
        y = 40 + (index // 2) * 560
        paste_panel(canvas, screenshot, (x, y, 680, 500), label)
    canvas.save(IMAGES / "viewer_grid.png", optimize=True)


def build_viewer_animation_gif() -> None:
    """Create a looping GIF from real browser viewer screenshots."""

    frame_paths = [
        "viewer_volume_04.png",
        "viewer_volume_08.png",
        "viewer_volume_12.png",
        "viewer_volume_20.png",
    ]
    if any(not (IMAGES / path).exists() for path in frame_paths):
        return

    keyframes = [
        cover_resize(Image.open(IMAGES / path).convert("RGB"), (960, 615))
        for path in frame_paths
    ]
    animation_frames: list[Image.Image] = []
    in_between_frames = 8
    for start, end in zip(keyframes, keyframes[1:]):
        animation_frames.append(start)
        for blend_step in range(1, in_between_frames + 1):
            alpha = blend_step / (in_between_frames + 1)
            animation_frames.append(Image.blend(start, end, alpha))
    animation_frames.append(keyframes[-1])

    animation_frames[0].save(
        IMAGES / "viewer_animation.gif",
        save_all=True,
        append_images=animation_frames[1:],
        duration=90,
        loop=0,
        optimize=True,
    )


def main() -> None:
    """Generate every report-specific image."""

    build_opening_result()
    build_explosive_sequence()
    build_milestone_2d_sequence()
    build_rendering_breakdown()
    build_physics_regions()
    build_viewer_grid()
    build_viewer_animation_gif()


if __name__ == "__main__":
    main()
