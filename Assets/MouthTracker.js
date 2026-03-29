//@input Component.Head headBinding

//@input float dMin = 0.15
//@input float dMax = 0.30
//@input float awMin = 0.25
//@input float awMax = 0.60
//@input float gMin = 0.15
//@input float gMax = 0.30

//@input float attemptTimeout = 1.5
//@input float requiredRise = 0.08
//@input bool debugPrint = true

print("DOG PATTERN DETECTOR LOADED");

var LEFT_MOUTH = 48;
var RIGHT_MOUTH = 54;
var UPPER_LIP = 62;
var LOWER_LIP = 66;

var STATE_WAITING_FOR_D = 0;
var STATE_WAITING_FOR_AW = 1;
var STATE_WAITING_FOR_G = 2;

var currentState = STATE_WAITING_FOR_D;
var attemptStartTime = -1;
var dRatio = -1;
var awRatio = -1;
var lastDetectionTime = -10;
var detectionCooldown = 1.0;

function dist2D(a, b) {
    var dx = a.x - b.x;
    var dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
}

function inRange(value, minVal, maxVal) {
    return value >= minVal && value <= maxVal;
}

function resetDetector() {
    currentState = STATE_WAITING_FOR_D;
    attemptStartTime = -1;
    dRatio = -1;
    awRatio = -1;
    if (script.debugPrint) {
        print("RESET TO WAITING_FOR_D");
    }
}

function startAttempt() {
    attemptStartTime = getTime();
}

function timedOut() {
    if (attemptStartTime < 0) {
        return false;
    }
    return (getTime() - attemptStartTime) > script.attemptTimeout;
}

script.createEvent("UpdateEvent").bind(function () {
    if (!script.headBinding) {
        return;
    }

    if (script.headBinding.getFacesCount() < 1) {
        return;
    }

    var leftMouth = script.headBinding.getLandmark(LEFT_MOUTH);
    var rightMouth = script.headBinding.getLandmark(RIGHT_MOUTH);
    var upperLip = script.headBinding.getLandmark(UPPER_LIP);
    var lowerLip = script.headBinding.getLandmark(LOWER_LIP);

    if (!leftMouth || !rightMouth || !upperLip || !lowerLip) {
        return;
    }

    var mouthWidth = dist2D(leftMouth, rightMouth);
    var mouthOpen = dist2D(upperLip, lowerLip);

    if (mouthWidth <= 0) {
        return;
    }

    var openRatio = mouthOpen / mouthWidth;

    if (!isFinite(openRatio)) {
        return;
    }

    if (script.debugPrint) {
        print("Open Ratio: " + openRatio.toFixed(3));
    }

    if (currentState !== STATE_WAITING_FOR_D && timedOut()) {
        print("DOG ATTEMPT TIMED OUT");
        resetDetector();
        return;
    }

    if ((getTime() - lastDetectionTime) < detectionCooldown) {
        return;
    }

    if (currentState === STATE_WAITING_FOR_D) {
        if (inRange(openRatio, script.dMin, script.dMax)) {
            dRatio = openRatio;
            startAttempt();
            currentState = STATE_WAITING_FOR_AW;
            print("Detected D shape at " + dRatio.toFixed(3));
        }
        return;
    }

    if (currentState === STATE_WAITING_FOR_AW) {
        if (inRange(openRatio, script.awMin, script.awMax) && (openRatio - dRatio) >= script.requiredRise) {
            awRatio = openRatio;
            currentState = STATE_WAITING_FOR_G;
            print("Detected AW shape at " + awRatio.toFixed(3));
        }
        return;
    }

    if (currentState === STATE_WAITING_FOR_G) {
        if (inRange(openRatio, script.gMin, script.gMax) && openRatio < awRatio) {
            print("DOG SOUND DETECTED");
            lastDetectionTime = getTime();
            resetDetector();
        }
        return;
    }
});