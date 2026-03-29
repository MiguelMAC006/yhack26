// MouthPronunciationCoach.js
// Version: 1.1.0
// Tracks mouth shape in real-time and gives pronunciation coaching
// with visual indicators at key lip positions and text feedback.

// @input Component.Head headBinding
// @input Component.Camera camera             {"label":"Camera"}

//@ui {"widget":"separator"}
// @input int targetWord {"widget":"combobox", "values":[{"label":"Wow", "value":0}, {"label":"Yes", "value":1}, {"label":"Dog", "value":2}]}

//@ui {"widget":"separator"}
// @input Component.Text wordDisplayText    {"label":"Word Display Text"}
// @input Component.Text feedbackText       {"label":"Feedback Text"}

//@ui {"widget":"separator"}
// @input SceneObject upperLipIndicator     {"label":"Upper Lip Arrow"}
// @input SceneObject lowerLipIndicator     {"label":"Lower Lip Arrow"}
// @input SceneObject leftCornerIndicator   {"label":"Left Corner Dot"}
// @input SceneObject rightCornerIndicator  {"label":"Right Corner Dot"}

// @input float indicatorOffsetY = 1.5      {"label":"Arrow Offset (world units)"}

//@ui {"widget":"separator"}
// @input bool printDebug

// ─── State ───────────────────────────────────────────────────────────────────
var isInitialized = false;
var isFaceTracking = false;
var landmarksListenerAdded = false;
var headBindingTransform;

var allLandmarks = [];
var shapeRatio = 0;
var smoothedRatio = 0;
var feedbackTimer = 0;
var FEEDBACK_INTERVAL = 0.25;

// ─── Mouth landmark indices ───────────────────────────────────────────────────
var IDX_UPPER_CENTER  = 51;
var IDX_LOWER_CENTER  = 57;
var IDX_LEFT_CORNER   = 48;
var IDX_RIGHT_CORNER  = 54;

// ─── Word targets ─────────────────────────────────────────────────────────────
var WORD_TARGETS = [
    {
        label:    "wow",
        minRatio: 0.50,
        maxRatio: 0.90,
        lowMsg:   "Pucker your lips into a round O shape",
        highMsg:  "Bring your lips a little closer",
        goodMsg:  "Great — lips nicely rounded!",
        tip:      "Round and pucker both lips forward"
    },
    {
        label:    "yes",
        minRatio: 0.25,
        maxRatio: 0.55,
        lowMsg:   "Drop your jaw — open your mouth more",
        highMsg:  "Relax — close your mouth slightly",
        goodMsg:  "Good open mouth shape!",
        tip:      "Jaw drops, mouth opens relaxed and wide"
    },
    {
        label:    "dog",
        minRatio: 0.55,
        maxRatio: 0.85,
        lowMsg:   "Drop your jaw more for the AW sound",
        highMsg:  "Relax your jaw slightly",
        goodMsg:  "Good shape — now finish with G!",
        tip:      "D (slight open) -> AW (drop jaw) -> G (close)"
    }
];

// ─── Initialisation ──────────────────────────────────────────────────────────
function onLensStart() {
    if (!script.headBinding) {
        print("MouthPronunciationCoach ERROR: headBinding not assigned.");
        return;
    }
    if (!script.camera) {
        print("MouthPronunciationCoach ERROR: camera not assigned. Drag your Camera object into the Camera field.");
        return;
    }

    headBindingTransform = script.headBinding.getTransform();

    var target = WORD_TARGETS[script.targetWord];
    if (script.wordDisplayText) {
        script.wordDisplayText.text = target.label;
    }
    if (script.feedbackText) {
        script.feedbackText.text = target.tip;
    }

    var faceFoundEvent = script.createEvent("FaceFoundEvent");
    faceFoundEvent.faceIndex = script.headBinding.faceIndex;
    faceFoundEvent.bind(onFaceFound);

    var faceLostEvent = script.createEvent("FaceLostEvent");
    faceLostEvent.faceIndex = script.headBinding.faceIndex;
    faceLostEvent.bind(onFaceLost);

    showIndicators(false);
    isInitialized = true;
    print("MouthPronunciationCoach: initialized OK");
}

// ─── Face tracking callbacks ──────────────────────────────────────────────────
function onFaceFound() {
    isFaceTracking = true;
    showIndicators(true);
    print("MouthPronunciationCoach: face found");

    if (!landmarksListenerAdded) {
        script.headBinding.onLandmarksUpdate.add(function(landmarks) {
            onLandmarksUpdate(landmarks);
        });
        landmarksListenerAdded = true;
    }
}

function onFaceLost() {
    isFaceTracking = false;
    allLandmarks = [];
    showIndicators(false);
    if (script.feedbackText) {
        script.feedbackText.text = "Position your face in view";
    }
}

// ─── Landmark update ──────────────────────────────────────────────────────────
function onLandmarksUpdate(landmarks) {
    if (!isInitialized || !landmarks) return;
    allLandmarks = landmarks;
    updateMouthMeasurements(landmarks);
    updateIndicatorPositions();
}

function updateMouthMeasurements(landmarks) {
    var depth = getDepth();

    var lmUpper = landmarks[IDX_UPPER_CENTER];
    var lmLower = landmarks[IDX_LOWER_CENTER];
    var lmLeft  = landmarks[IDX_LEFT_CORNER];
    var lmRight = landmarks[IDX_RIGHT_CORNER];

    if (!lmUpper || !lmLower || !lmLeft || !lmRight) return;

    var wUpper = script.camera.screenSpaceToWorldSpace(lmUpper, depth);
    var wLower = script.camera.screenSpaceToWorldSpace(lmLower, depth);
    var wLeft  = script.camera.screenSpaceToWorldSpace(lmLeft,  depth);
    var wRight = script.camera.screenSpaceToWorldSpace(lmRight, depth);

    var openness = Math.abs(wLower.y - wUpper.y);
    var width    = Math.abs(wRight.x - wLeft.x);

    if (width > 0.001) {
        var raw = openness / width;
        smoothedRatio = lerp(smoothedRatio, raw, 0.12);
        shapeRatio = smoothedRatio;
    }

    if (script.printDebug) {
        print("open=" + openness.toFixed(3) +
              "  width=" + width.toFixed(3) +
              "  ratio=" + shapeRatio.toFixed(3));
    }
}

// ─── Per-frame update (feedback text only) ───────────────────────────────────
function onUpdate(eventData) {
    if (!isInitialized || !isFaceTracking || allLandmarks.length === 0) return;

    feedbackTimer -= eventData.getDeltaTime();
    if (feedbackTimer <= 0) {
        updateFeedback();
        feedbackTimer = FEEDBACK_INTERVAL;
    }
}

// ─── Indicator positioning ────────────────────────────────────────────────────
function updateIndicatorPositions() {
    var depth = getDepth();
    var off   = script.indicatorOffsetY;

    placeIndicator(script.upperLipIndicator,    allLandmarks[IDX_UPPER_CENTER],  depth,  off,  0);
    placeIndicator(script.lowerLipIndicator,    allLandmarks[IDX_LOWER_CENTER],  depth, -off,  0);
    placeIndicator(script.leftCornerIndicator,  allLandmarks[IDX_LEFT_CORNER],   depth,  0,   -off * 0.6);
    placeIndicator(script.rightCornerIndicator, allLandmarks[IDX_RIGHT_CORNER],  depth,  0,    off * 0.6);
}

function placeIndicator(obj, lm, depth, offsetY, offsetX) {
    if (!obj || !lm) return;
    var worldPos = script.camera.screenSpaceToWorldSpace(lm, depth);
    worldPos.y += offsetY;
    worldPos.x += offsetX;
    obj.getTransform().setWorldPosition(worldPos);
}

// ─── Feedback logic ───────────────────────────────────────────────────────────
function updateFeedback() {
    var target  = WORD_TARGETS[script.targetWord];
    var ratio   = shapeRatio;
    var inRange = (ratio >= target.minRatio && ratio <= target.maxRatio);
    var msg;
    var r, g, b;

    if (inRange) {
        msg = target.goodMsg;
        r = 0.2;  g = 0.95; b = 0.3;
    } else if (ratio < target.minRatio) {
        msg = target.lowMsg;
        r = 1.0;  g = 0.55; b = 0.1;
    } else {
        msg = target.highMsg;
        r = 0.95; g = 0.2;  b = 0.2;
    }

    if (script.feedbackText) {
        script.feedbackText.text = msg;
    }
    tintAllIndicators(r, g, b);
}

// ─── Tinting ──────────────────────────────────────────────────────────────────
function tintAllIndicators(r, g, b) {
    tintObject(script.upperLipIndicator,    r, g, b);
    tintObject(script.lowerLipIndicator,    r, g, b);
    tintObject(script.leftCornerIndicator,  r, g, b);
    tintObject(script.rightCornerIndicator, r, g, b);
}

function tintObject(obj, r, g, b) {
    if (!obj) return;
    var mesh = obj.getComponent("Component.RenderMeshVisual");
    if (mesh) {
        var c = mesh.mainPass.baseColor;
        mesh.mainPass.baseColor = new vec4(r, g, b, c.w);
        return;
    }
    var img = obj.getComponent("Component.Image");
    if (img) {
        var ci = img.mainPass.baseColor;
        img.mainPass.baseColor = new vec4(r, g, b, ci.w);
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function showIndicators(visible) {
    if (script.upperLipIndicator)    script.upperLipIndicator.enabled    = visible;
    if (script.lowerLipIndicator)    script.lowerLipIndicator.enabled    = visible;
    if (script.leftCornerIndicator)  script.leftCornerIndicator.enabled  = visible;
    if (script.rightCornerIndicator) script.rightCornerIndicator.enabled = visible;
}

function getDepth() {
    return -headBindingTransform.getLocalPosition().z;
}

function lerp(a, b, t) {
    return a + (b - a) * t;
}

// ─── Events ───────────────────────────────────────────────────────────────────
script.createEvent("OnStartEvent").bind(onLensStart);
script.createEvent("UpdateEvent").bind(onUpdate);
