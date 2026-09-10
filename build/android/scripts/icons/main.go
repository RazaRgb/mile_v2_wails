// Command icons generates Android launcher mipmaps from build/appicon.png.
//
// Wails' own `generate icons` command only produces Windows (.ico) and macOS
// (.icns/Assets.car) assets, so the Android template ships a default launcher
// icon that never changes when appicon.png is updated. This tool fills that
// gap: it scales the source icon down to every launcher density and overwrites
// the mipmap PNGs referenced by AndroidManifest.xml (@mipmap/ic_launcher and
// @mipmap/ic_launcher_round).
//
// It uses only the standard library so it works on any machine/CI that can
// build the app (which already requires Go), with no ImageMagick dependency.
package main

import (
	"flag"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"math"
	"os"
	"path/filepath"
)

// Standard Android launcher icon sizes, in device pixels.
var densities = []struct {
	name string
	size int
}{
	{"mdpi", 48},
	{"hdpi", 72},
	{"xhdpi", 96},
	{"xxhdpi", 144},
	{"xxxhdpi", 192},
}

func main() {
	input := flag.String("input", "build/appicon.png", "source PNG icon")
	out := flag.String("out", "build/android/app/src/main/res", "Android res directory")
	flag.Parse()

	file, err := os.Open(*input)
	if err != nil {
		fail("open input icon %q: %v", *input, err)
	}
	defer file.Close()

	src, err := png.Decode(file)
	if err != nil {
		fail("decode %q (must be a PNG): %v", *input, err)
	}

	for _, d := range densities {
		scaled := boxScale(src, d.size, d.size)
		dir := filepath.Join(*out, "mipmap-"+d.name)
		if err := os.MkdirAll(dir, 0o755); err != nil {
			fail("create %q: %v", dir, err)
		}
		for _, name := range []string{"ic_launcher.png", "ic_launcher_round.png"} {
			if err := writePNG(filepath.Join(dir, name), scaled); err != nil {
				fail("write %q: %v", filepath.Join(dir, name), err)
			}
		}
	}

	fmt.Printf("Generated Android launcher icons from %s\n", *input)
}

// boxScale resizes src to w x h using an alpha-weighted box filter (area
// average). Averaging in premultiplied space and un-premultiplying afterwards
// avoids dark fringes around transparent edges such as rounded icon corners.
func boxScale(src image.Image, w, h int) *image.NRGBA {
	b := src.Bounds()
	sw, sh := b.Dx(), b.Dy()
	dst := image.NewNRGBA(image.Rect(0, 0, w, h))

	for dy := 0; dy < h; dy++ {
		y0 := b.Min.Y + dy*sh/h
		y1 := b.Min.Y + (dy+1)*sh/h
		if y1 <= y0 {
			y1 = y0 + 1
		}
		for dx := 0; dx < w; dx++ {
			x0 := b.Min.X + dx*sw/w
			x1 := b.Min.X + (dx+1)*sw/w
			if x1 <= x0 {
				x1 = x0 + 1
			}

			var sr, sg, sb, sa, n float64
			for y := y0; y < y1; y++ {
				for x := x0; x < x1; x++ {
					r, g, bb, a := src.At(x, y).RGBA() // premultiplied, 0..65535
					sr += float64(r)
					sg += float64(g)
					sb += float64(bb)
					sa += float64(a)
					n++
				}
			}
			if n == 0 {
				continue
			}

			pr, pg, pb, pa := sr/n, sg/n, sb/n, sa/n
			var out color.NRGBA
			out.A = uint8(math.Round(pa / 257))
			if pa > 0 {
				out.R = clamp8(pr * 255 / pa)
				out.G = clamp8(pg * 255 / pa)
				out.B = clamp8(pb * 255 / pa)
			}
			dst.SetNRGBA(dx, dy, out)
		}
	}
	return dst
}

func clamp8(v float64) uint8 {
	switch {
	case v <= 0:
		return 0
	case v >= 255:
		return 255
	default:
		return uint8(math.Round(v))
	}
}

func writePNG(path string, img image.Image) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	if err := png.Encode(f, img); err != nil {
		f.Close()
		return err
	}
	return f.Close()
}

func fail(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "error: "+format+"\n", args...)
	os.Exit(1)
}
