# Vendored data

- `canonical_face_model.obj`: MediaPipe's canonical face mesh
  ([source](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/modules/face_geometry/data/canonical_face_model.obj)),
  Apache License 2.0. `scripts/build-face-mesh.ts` turns it into `web/src/faces/mesh-data.ts`.
- `web/public/models/face_landmarker.task`: MediaPipe Face Landmarker model, float16 v1
  ([source](https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task)),
  Apache License 2.0. Bundled so face tracking works without internet.
