//@input Component.Head headBinding

script.createEvent("UpdateEvent").bind(function () {
    if (script.headBinding.getFacesCount() < 1) return;

    for (var i = 0; i < 93; i++) {
        var p = script.headBinding.getLandmark(i);
        print("Landmark " + i + ": " + p);
    }
});