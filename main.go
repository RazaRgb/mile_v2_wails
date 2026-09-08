package main

import (
	"embed"
	"log"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// Wails embeds the built frontend (frontend/dist) into the binary and serves
// it to the WebView. The app is a thin shell: all logic lives in the React
// frontend, which talks to the Go backend over HTTP (VITE_API_URL).

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app := application.New(application.Options{
		Name:        "mile",
		Description: "Mile — micro-learning reels",
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
	})

	app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title: "Mile",
		Width: 500,
		Height: 1400,
		Mac: application.MacWindow{
			InvisibleTitleBarHeight: 50,
			Backdrop:                application.MacBackdropTranslucent,
			TitleBar:                application.MacTitleBarHiddenInset,
		},
		BackgroundColour: application.NewRGB(2, 6, 23),
		URL:              "/",
		InitialPosition: application.WindowStartPosition(1),
	})

	// Mobile: light status-bar icons over the dark theme (no-op on desktop).
	// Called after a short delay so the platform bridge is ready.
	go func() {
		time.Sleep(200 * time.Millisecond)
		application.Mobile.SetStatusBar(`{"style":"light","hidden":false}`)
	}()

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
