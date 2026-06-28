# Face Signal Lab

Browser-only portfolio demo for camera-based face signal visualization.

This public copy is self-contained: MediaPipe Face Mesh and Lucide runtime files are stored locally in `assets/libs`. It does not require a backend, external CDN, API key, account, activation key or cloud service.

## Features

- Detect and visualize facial landmarks in the browser.
- Show face position, head tilt and lighting status.
- Draw face bounding box, landmark guides and expression cues on Canvas.
- Provide self-reported profile fields for age range, gender and mood.
- Use OBS-friendly fullscreen mode with `?obs=1`.

## Run

Use any static local server. A server is needed only because browsers restrict camera and WebAssembly loading from `file://`.

```powershell
python -m http.server 5174
```

Open:

```text
http://localhost:5174
```

## Privacy Notes

- The camera stream stays in the browser.
- No frames are uploaded anywhere.
- The app does not infer identity, age, gender or inner emotional state.
- Age range, gender and mood are fields entered by the user.

## Portfolio Notes

This project is useful as a frontend/Web API portfolio item: WebRTC camera access, MediaPipe face landmarks, Canvas overlays, local-first privacy and real-time UI state.
