// KeywordDetectionController.js
// Controls the audio spectrogram, passes spectrogram texture to the ML model and analyzes model output
// ML model predicts the probability of certain word
// Version 0.0.1
// Event : onStartEvent 

// @ui {"widget" : "label", "label" : "ML Model Settings"}
// @input Asset.MLAsset model
// @input Component.ScriptComponent labels 
// @ui {"widget" : "separator"}
// @input Asset.AudioTrackAsset audioSource {"label" : "Audio Track"}

// @ui {"widget" : "separator"}
// @input float threshold = 0.6 {"widget" : "slider", "min":"0", "max" : 1 , "step" : 0.01}


// @ui {"widget" : "separator"}
// @input bool useBehavior
// @input string customTriggerPrefix = "KEYWORD_"{"showIf" : "useBehavior"}
// @ui {"widget" : "separator"}
// @input bool advanced

// @input Component.ScriptComponent audioSpectrogramScript {"showIf" : "advanced"}

// @ui {"widget":"group_start", "label":"Processing", "showIf" : "advanced"}
// @input int type = 0 {"widget" : "combobox", "values" : [{"label" : "Fixed interval", "value" : 0}, {"label" : "Check Loud threshold", "value" : 1}]}
// @input float loudThreshold = 2000 {"showIf" : "type", "showIfValue": 1}
// @input float noiseThreshold = 400 {"showIf" : "type", "showIfValue": 1}
// @input vec2 window = {10, 64} {"showIf" : "type", "showIfValue": 1}
// @input int processingDelay = 16 {"showIf" : "type", "showIfValue": 1}
// @input float deltaTime = 5.0 {"showIf" : "type", "showIfValue": 0}
// @ui {"widget":"group_end"}
// @ui {"widget" : "separator", "showIf" : "advanced"}
// @ui {"widget":"group_start", "label":"Debug", "showIf" : "advanced"}
// @input Component.Text classText
// @input Component.Text probText
// @input Component.Image debugImage
// @ui {"widget":"group_end"}

var skippedFrames = 0;

var labels;
var output;
var input;

var outputArgMaxTensor = new Uint32Array(2);
var oneValueResult = new Float32Array(1);

var outputDataShape;
var sumOnPrefixShape;
var sumOnWindowShape;

var vecZero = vec3.zero();

var spectrogramSize;
var mlComponent;
var audioSpectrogram;

var timeLeft = script.deltaTime;



function init() {
    if (!initSpectrogramController() || !initMLComponent()) {
        return;
    }
    if (script.useBehavior && global.behaviorSystem == undefined) {
        print("Warning, Behavior system not initialized. Make sure a Behavior script is present in the scene, and above this in the Objects panel hierarchy.");
        script.useBehavior = false;
    }
}

function initSpectrogramController() {
    if (!script.audioSpectrogramScript) {
        print("Warning, Audio Spectrogram Script is not set (under advanced checkbox)");
        return false;
    }
    if (!script.audioSource) {
        print("Warning, Audio Track is not set");
        return false;
    }
    audioSpectrogram = script.audioSpectrogramScript;
    audioSpectrogram.init(script.audioSource);

    spectrogramSize = audioSpectrogram.getSpectrogramSize();

    sumOnPrefixShape = new vec3(spectrogramSize.x, script.window.x, 1);
    sumOnWindowShape = new vec3(spectrogramSize.x, script.window.y, 1);

    if (script.audioSource.control.isOfType("Provider.MicrophoneAudioProvider")) {
        print("Info, To start using Audio From Microphone enable it at the bottom of the Preview Panel");
        script.audioSource.control.start();
    } else {
        print("Info, You are using test Audio Track input. Click on the [Audio Track] input field of the Keyword Detection Controller and select [Audio From Microphone]");
        script.audioSource.control.loops = -1;
    }
    return true;
}

function initMLComponent() {
    if (!script.model) {
        print("Warning, ML Model asset is not set");
        return false;
    }
    //set model
    mlComponent = script.getSceneObject().createComponent("Component.MLComponent");
    mlComponent.model = script.model;

    //create transformer because we generate rotated texture
    var inputPlaceholder = mlComponent.getInputs()[0];

    var transformer = MachineLearning.createTransformerBuilder()
        .setStretch(true)
        .setRotation(TransformerRotation.Rotate90)
        .build();
    input = MachineLearning.createInputBuilder()
        .setName(inputPlaceholder.name)
        .setShape(inputPlaceholder.shape)
        .setTransformer(transformer)
        .build();

    output = mlComponent.getOutputs()[0];
    //channels first
    outputDataShape = new vec3(output.shape.z, 1, 1);

    if (script.labels == undefined || script.labels.labels == undefined) {
        print("Warning, Class map script is not set");
        return false;
    }
    labels = script.labels.labels;

    if (labels.length != outputDataShape.x) {
        print("Warning, Classes amount in the Class map does not match this ml model, try to swap script on the Labels [SWAP LABELS] scene object");
        return false;
    }

    mlComponent.onLoadingFinished = onLoadingFinished;
    mlComponent.build([input, output]);
    return true;
}

function onLoadingFinished() {
    input.texture = audioSpectrogram.getSpectrogramTexture();

    mlComponent.onRunningFinished = onRunningFinished;

    var updateEvent = script.createEvent("UpdateEvent");
    updateEvent.bind(onUpdate);
}

function onUpdate(eventData) {
    var b = audioSpectrogram.processAudioFrame();
    //uncomment below to see live texture update
    //audioSpectrogram.updateSpectrogramTexture();
    if (script.type == 1) {
        if (b == false
            || skippedFrames > 0
            || mlComponent.state != MachineLearning.ModelState.Idle) {
            if (skippedFrames > 0) {
                --skippedFrames;
            }
            return;
        }
        if (checkLoudThreshold()) {
           
            skippedFrames = script.processingDelay;
        } else {
            return;
        }
    } else if (b == false
        || timeLeft > 0
        || mlComponent.state != MachineLearning.ModelState.Idle) {
        if (timeLeft > 0) {
            timeLeft -= eventData.getDeltaTime();

        }
        return;
    }
    
    audioSpectrogram.updateSpectrogramTexture();
    mlComponent.runImmediate(false);
    timeLeft = script.deltaTime; 
}


function onRunningFinished() {

    var classIdx = getDetectedClassId(output.data);
    var classProb = output.data[classIdx];

    if (classProb >= script.threshold) {
        updateDebug(labels[classIdx], classProb.toFixed(2));
        if (script.useBehavior) {
            var customTrigger = script.customTriggerPrefix + labels[classIdx].toUpperCase();
            global.behaviorSystem.sendCustomTrigger(customTrigger);
        }
    } else {
        updateDebug("", "");
    }
}


function getDetectedClassId(data) {
    TensorMath.softMax(data, outputDataShape, data);
    TensorMath.argMax(data, outputDataShape, outputArgMaxTensor);
    return outputArgMaxTensor[0];
}

function checkLoudThreshold() {
    var data = audioSpectrogram.getSpectrogramData();
    var sumOnPrefix = 0;
    var sumOnWindow = 0;
    TensorMath.sum(data, sumOnPrefixShape, vecZero, oneValueResult);
    sumOnPrefix = oneValueResult[0];
    TensorMath.sum(data, sumOnWindowShape, vecZero, oneValueResult);
    sumOnWindow = oneValueResult[0] - sumOnPrefix;
    return (sumOnWindow >= script.loudThreshold && sumOnPrefix < script.noiseThreshold);
}

function updateDebug(text1, text2) {
    if (script.classText) {
        script.classText.text = text1;
    }
    if (script.probText) {
        script.probText.text = text2;
    }
}


script.createEvent("OnStartEvent").bind(function(eventData){
    init();
});