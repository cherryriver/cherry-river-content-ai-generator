#!/usr/local/opt/python@3.11/bin/python3.11
"""
Seedance 2.0 watermark remover.
Auto-detects static AI watermark in any corner using frame averaging + Canny edges,
then removes it with OpenCV TELEA inpainting.

Usage: python3 remove_watermark.py input.mp4 output.mp4
"""

import sys
import os
import subprocess
import tempfile
import shutil
import numpy as np
import cv2

def sample_frames(cap, n=60):
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    step = max(1, total // n)
    frames = []
    for i in range(0, total, step):
        cap.set(cv2.CAP_PROP_POS_FRAMES, i)
        ret, frame = cap.read()
        if ret:
            frames.append(frame.astype(np.float32))
        if len(frames) >= n:
            break
    return frames

def detect_watermark_corner(frames, height, width):
    """Find which corner has the static watermark using temporal stability + edge density."""
    corner_h = max(60, int(height * 0.08))
    corner_w = max(120, int(width * 0.12))

    corners = {
        "top_left":     (0, 0, corner_h, corner_w),
        "top_right":    (0, width - corner_w, corner_h, corner_w),
        "bottom_left":  (height - corner_h, 0, corner_h, corner_w),
        "bottom_right": (height - corner_h, width - corner_w, corner_h, corner_w),
    }

    mean_frame = np.mean(frames, axis=0).astype(np.uint8)
    std_map = np.std(frames, axis=0).mean(axis=2)  # temporal std per pixel

    best_score = -1
    best_region = None

    for name, (y, x, h, w) in corners.items():
        roi_mean = cv2.cvtColor(mean_frame[y:y+h, x:x+w], cv2.COLOR_BGR2GRAY)
        edges = cv2.Canny(roi_mean, 30, 80)
        edge_px = edges.sum() / 255
        roi_area = h * w
        edge_density = edge_px / roi_area

        temporal_std = std_map[y:y+h, x:x+w].mean()
        stability = 1.0 / (1.0 + temporal_std)
        score = edge_density * stability

        print(f"  Corner {name}: edge_density={edge_density:.4f} stability={stability:.4f} score={score:.6f}")

        if edge_density > 0.002 and edge_px > 20 and score > best_score:
            best_score = score
            best_region = (x, y, w, h)  # x,y,w,h format

    return best_region, mean_frame

def build_mask(mean_frame, region, shape):
    x, y, w, h = region
    mask = np.zeros(shape[:2], dtype=np.uint8)
    roi = cv2.cvtColor(mean_frame[y:y+h, x:x+w], cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(roi, 30, 80)
    kernel = np.ones((5, 5), np.uint8)
    edges = cv2.dilate(edges, kernel, iterations=1)

    # Use connected components to remove noise
    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(edges)
    clean_edges = np.zeros_like(edges)
    for i in range(1, num_labels):
        if stats[i, cv2.CC_STAT_AREA] >= 100:
            clean_edges[labels == i] = 255

    if clean_edges.sum() == 0:
        clean_edges = np.ones((h, w), dtype=np.uint8) * 255  # fallback: full rect

    mask[y:y+h, x:x+w] = clean_edges
    return mask

def remove_watermark(input_path, output_path):
    cap = cv2.VideoCapture(input_path)
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video: {input_path}")

    fps = cap.get(cv2.CAP_PROP_FPS)
    width  = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total  = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    print(f"Video: {width}x{height} @ {fps}fps, {total} frames")

    print("Sampling frames for watermark detection...")
    frames = sample_frames(cap, n=60)

    print("Detecting watermark corner...")
    region, mean_frame = detect_watermark_corner(frames, height, width)

    if region is None:
        print("No watermark detected — copying original.")
        shutil.copy2(input_path, output_path)
        cap.release()
        return

    x, y, w, h = region
    print(f"Watermark detected at x={x} y={y} w={w} h={h}")

    mask = build_mask(mean_frame, region, (height, width))

    # Process all frames
    tmpdir = tempfile.mkdtemp(prefix="cr_wm_")
    print(f"Processing {total} frames...")
    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
    idx = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        clean = cv2.inpaint(frame, mask, inpaintRadius=5, flags=cv2.INPAINT_TELEA)
        cv2.imwrite(os.path.join(tmpdir, f"{idx:06d}.png"), clean)
        idx += 1
        if idx % 30 == 0:
            print(f"  {idx}/{total} frames done")

    cap.release()
    print(f"All {idx} frames processed. Reassembling with ffmpeg...")

    cmd = [
        "ffmpeg", "-y",
        "-framerate", str(fps),
        "-i", os.path.join(tmpdir, "%06d.png"),
        "-i", input_path,
        "-map", "0:v",
        "-map", "1:a?",
        "-c:v", "libx264",
        "-crf", "18",
        "-preset", "fast",
        "-pix_fmt", "yuv420p",
        "-c:a", "copy",
        "-movflags", "+faststart",
        output_path,
    ]
    subprocess.run(cmd, check=True)
    shutil.rmtree(tmpdir, ignore_errors=True)
    print(f"Done: {output_path}")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python3 remove_watermark.py input.mp4 output.mp4")
        sys.exit(1)
    remove_watermark(sys.argv[1], sys.argv[2])
