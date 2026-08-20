import base64
import numpy as np
import cv2

from .config import YU_NET_MODEL, SFACE_MODEL, RECONOCIMIENTO_THRESHOLD, MAX_FACE

ARCFACE_SRC = np.array([
    [38.2946, 51.6963],
    [73.5318, 51.5014],
    [56.0252, 71.7366],
    [41.5493, 92.3655],
    [70.7299, 92.2041],
], dtype=np.float32)


def norm_crop(img, landmarks, size=112):
    M, _ = cv2.estimateAffinePartial2D(np.asarray(landmarks, dtype=np.float32), ARCFACE_SRC, method=cv2.LMEDS)
    if M is None:
        return None
    return cv2.warpAffine(img, M, (size, size), borderValue=0.0)

class FaceEngine:
    def __init__(self, threshold=RECONOCIMIENTO_THRESHOLD):
        self.threshold = threshold
        self.detector = cv2.FaceDetectorYN.create(
            YU_NET_MODEL, "", (320, 240),
            score_threshold=0.85, nms_threshold=0.3, top_k=20
        )
        self.recognizer = cv2.FaceRecognizerSF.create(SFACE_MODEL, "")

    @staticmethod
    def decode_img(data: bytes):
        arr = np.frombuffer(data, dtype=np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        return img

    def detect(self, img, max_side=MAX_FACE):
        if img is None:
            return []
        h, w = img.shape[:2]
        scale = 1.0
        if max_side and max(h, w) > max_side:
            scale = max_side / float(max(h, w))
            img = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
        self.detector.setInputSize((img.shape[1], img.shape[0]))
        _, faces = self.detector.detect(img)
        out = []
        if faces is not None:
            for f in faces:
                x, y, fw, fh = (int(v) for v in f[:4])
                lm = [[float(f[i]), float(f[i + 1])] for i in range(4, 14, 2)]
                if scale != 1.0:
                    x, y, fw, fh = int(x / scale), int(y / scale), int(fw / scale), int(fh / scale)
                    lm = [[v / scale for v in p] for p in lm]
                out.append({
                    "box": [x, y, fw, fh],
                    "score": float(f[14]),
                    "landmarks": lm
                })
        return out

    def embed(self, img, landmarks):
        if img is None or landmarks is None:
            return None
        aligned = norm_crop(img, landmarks)
        if aligned is None or aligned.size == 0:
            return None
        feat = self.recognizer.feature(aligned).flatten().astype(np.float32)
        n = np.linalg.norm(feat)
        if n <= 0:
            return None
        return feat / n

    @staticmethod
    def embedding_to_b64(emb):
        return base64.b64encode(emb.tobytes()).decode("ascii")

    @staticmethod
    def b64_to_embedding(s):
        return np.frombuffer(base64.b64decode(s), dtype=np.float32)

    def match(self, emb, personas):
        best = None
        for p in personas:
            try:
                known = self.b64_to_embedding(p["embedding"])
            except Exception:
                continue
            if known.shape != emb.shape:
                continue
            sim = float(np.dot(emb, known))
            if best is None or sim > best[0]:
                best = (sim, p)
        if best is None or best[0] < self.threshold:
            return None
        return {"persona": best[1], "confianza": round(best[0], 4), "umbral": self.threshold}
