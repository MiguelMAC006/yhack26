// AudioSpectrogram.js
// A class that allows to create a spectrogram texture based on the mel spectrogram
// Version 0.0.1
// Event : onAwake

// @input bool advanced
// @ui {"widget":"separator","showIf" : "advanced"}
// @ui {"widget":"label", "label":"Mel Spectrogram Settings:", "showIf" : "advanced"}
// @input int frameSize = 512 {"showIf" : "advanced"}
// @input int hopSize = 128 {"showIf" : "advanced"}
// @input int fftSize = 2048 {"showIf" : "advanced"}
// @input int numMel = 128 {"showIf" : "advanced"}
// @input float minFreq = 0.0 {"showIf" : "advanced"}
// @input float maxFreq = 8000.0 {"showIf" : "advanced"}
// @input int sampleRate = 44100 {"widget" : "combobox", "values" : [{"label" : "4000", "value" : 4000}, {"label" : "8000", "value" : 8000},{"label" : "16000", "value" : 16000}, {"label" : "32000", "value" : 32000}, {"label" : "44100", "value" : 44100}, {"label" : "48000", "value" : 48000}], "showIf" : "advanced"}
// @ui {"widget":"separator","showIf" : "advanced"}
// @ui {"widget":"label", "label":"Texture settings:", "showIf" : "advanced"}
// @ui {"widget":"label", "label":"Please note that we are generating texture rotated by 90 degrees", "showIf" : "advanced"}
// @ui {"widget":"label", "label":"then we use transformer when passing to the model", "showIf" : "advanced"}
// @ui {"widget":"label", "label":"you'll need to swap your x and y size here:", "showIf" : "advanced"}
// @input vec2 size = {128, 128} {"showIf" : "advanced"}
// @input Asset.Texture proxyTexture {"label" : "Placeholder","showIf" : "advanced"}

const MAX_AUDIO_FRAME_SIZE = 8192;
const MAX_BUFFER_SIZE = 64000;
const CHANNELS = 4;// RGBA
const VEC3_ZERO = vec3.zero();
const VEC3_ONE = vec3.one();
const EPS = 1e-6;

var audioFrame = null;
var audioSource = null;

var melSpectrogram = null;
var melSpectrogramBuffer = null;

var size = new vec2 (script.size.x, script.size.y); 
var spectrogramDataShape = new vec3(size.y, size.x, 1);
var spectrogramData = new Float32Array(size.x * size.y);
var spectrogramDataCopy = null;
var spectrogramBuffer = new Float32Array(size.x * size.y);
var totalSpectrogramRows = 0;

var spectrogramImageData = null;
var spectrogramImageDataFloat = null;

var spectrogramTexture = null;

var dataToImageRepeatShape = new vec3(CHANNELS, 1, 1);

var oneValueResult = new Float32Array(1);

function init(audioTrack) {
    initAudio(script.sampleRate, audioTrack);
    initMelSpectrogram(script.frameSize, script.hopSize, script.fftSize, script.numMel, script.minFreq, script.maxFreq, script.sampleRate);
    createSpectrogramTexture(size);
}

function initAudio(sampleRate, audioTrack) {
    audioSource = audioTrack.control;
    audioSource.sampleRate = sampleRate;
    if (audioSource.start) {
        audioSource.start();
    }
    audioFrame = new Float32Array(MAX_AUDIO_FRAME_SIZE);
}

function initMelSpectrogram(frameSize, hopSize, fftSize, numMel, minFreq, maxFreq, sampleRate) {
    var melBuilder = MachineLearning.createMelSpectrogramBuilder();
    melSpectrogram = melBuilder.setFrameSize(frameSize)
        .setHopSize(hopSize)
        .setFFTSize(fftSize)
        .setNumMel(numMel)
        .setMinFreq(minFreq)
        .setMaxFreq(maxFreq)
        .setSampleRate(sampleRate)
        .build();
    melSpectrogramBuffer = new Float32Array(MAX_BUFFER_SIZE); // huge magic number
}

function createSpectrogramTexture(size) {
    spectrogramTexture = ProceduralTextureProvider.create(size.x, size.y, Colorspace.RGBA);
    spectrogramImageData = new Uint8Array(size.x * size.y * CHANNELS);
    spectrogramImageDataFloat = new Float32Array(spectrogramImageData.length);
    if (script.proxyTexture) {
        script.proxyTexture.control = spectrogramTexture.control;
    }
}

function processAudioFrame() {
    if (!readAudioFrame()) {
        return false;
    }
    TensorMath.powerToDb(spectrogramBuffer, 80.0, spectrogramData);
    normalizeSpectrogramData();
    return true;
}

function readAudioFrame() {
    var audioFrameShape = audioSource.getAudioFrame(audioFrame);
    if (audioFrameShape.x == 0) {
        return false;
    }
    var melSpectrogramShape = melSpectrogram.process(audioFrame, audioFrameShape, melSpectrogramBuffer);
    var rows = melSpectrogramShape.y;
    if (melSpectrogramShape.x != size.x) { 
        print("Wrong shape of melSpectrogram data" + melSpectrogramShape.x);
        return false;
    }
    if (totalSpectrogramRows == size.y) {
        shiftSpectrogramBuffer(rows);
        readToSpectrogramBuffer(size.y - rows, rows);
    } else {
        
        var rowsToCopy = Math.min(rows, size.y - totalSpectrogramRows);
        //print(rows)
        totalSpectrogramRows += rowsToCopy;

        if (rowsToCopy != rows) {
            shiftSpectrogramBuffer(rows - rowsToCopy);
        }
        readToSpectrogramBuffer(totalSpectrogramRows - rows, rows);
    }
    return true;
}

function readToSpectrogramBuffer(from, rows) {
    var data = new Float32Array(melSpectrogramBuffer.buffer, 0, rows * size.x);
    spectrogramBuffer.set(data, from * size.x);
}

function updateSpectrogramTexture() {
    if (spectrogramTexture == null) {
        createSpectrogramTexture();
    }

    TensorMath.repeat(spectrogramData, spectrogramDataShape, dataToImageRepeatShape, spectrogramImageDataFloat);
    TensorMath.mulScalar(spectrogramImageDataFloat, 255, spectrogramImageDataFloat);

    spectrogramImageData.set(spectrogramImageDataFloat);
    spectrogramTexture.control.setPixels(0, 0, size.x, size.y, spectrogramImageData);
}

function normalizeSpectrogramData() {

    var data = spectrogramData;
    var dataCopy = spectrogramDataCopy;

    var shape = spectrogramDataShape;

    TensorMath.min(data, shape, oneValueResult);
    var min = oneValueResult[0];

    TensorMath.max(data, shape, oneValueResult);
    var max = oneValueResult[0];

    TensorMath.sum(data, shape, VEC3_ZERO, oneValueResult);
    var sum = oneValueResult[0];

    var mean = sum / (shape.x * shape.y);

    oneValueResult[0] = mean;
    if (dataCopy == null) {
        dataCopy = new Float32Array(data.length);
    }
    TensorMath.subTensors(data, shape, oneValueResult, VEC3_ONE, dataCopy);
    TensorMath.power(dataCopy, 2.0, dataCopy);

    TensorMath.sum(dataCopy, shape, VEC3_ZERO, oneValueResult);
    var std = Math.sqrt(oneValueResult[0]) + EPS;

    min = (min - mean) / std;
    max = (max - mean) / std;

    if (max - min > EPS) {
        oneValueResult[0] = std * (max - min);
        TensorMath.divTensors(data, shape, oneValueResult, VEC3_ONE, data);

        oneValueResult[0] = (mean / std + min) / (max - min);
        TensorMath.subTensors(data, shape, oneValueResult, VEC3_ONE, data);
    } else {
        if (data.fill) {
            data.fill(0);
        } else {
            for (var it = 0; it < data.length; ++it) {
                data[it] = 0;
            }
        }
    }
}

function shiftSpectrogramBuffer(rows) {
    if (spectrogramBuffer.copyWithin) {
        spectrogramBuffer.copyWithin(0, rows * size.x);
    } else {
        var data = spectrogramBuffer;
        var sizeX = size.x;
        var sizeY = size.y;
        var it1 = 0;
        var it2 = rows * sizeX;
        for (var y = rows; y < sizeY; ++y) {
            for (var x = 0; x < sizeX; ++x, ++it1, ++it2) {
                data[it1] = data[it2];
            }
        }
    }
}

function getSpectrogramTexture() {
    return spectrogramTexture;
}

function getSpectrogramData() {
    return spectrogramData;
}

function getSpectrogramSize() {
    return size;
}

script.init = init;
script.getSpectrogramData = getSpectrogramData;
script.getSpectrogramTexture = getSpectrogramTexture;
script.processAudioFrame = processAudioFrame;
script.updateSpectrogramTexture = updateSpectrogramTexture;
script.getSpectrogramSize = getSpectrogramSize;