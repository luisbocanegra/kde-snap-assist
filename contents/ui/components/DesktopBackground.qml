import QtQuick
import QtQuick.Window
import Qt5Compat.GraphicalEffects
import org.kde.kwin as KWinComponents

Item {
    y: - ((immersiveMode ? mainWindow.y : main.y) - minDy)
    x: - ((immersiveMode ? mainWindow.x : main.x) - minDx)
    height: Screen.height
    width: currentScreenWidth
    visible: showDesktopBackground && activated

    KWinComponents.WindowThumbnail {
        wId: desktopWindowId
        id: desktopBackground
        anchors.fill: parent
        layer.enabled: desktopBackgroundBlur > 0
    }

    FastBlur {
        id: blurBackground
        anchors.fill: parent
        source: desktopBackground
        radius: desktopBackgroundBlur
        cached: false
        visible: desktopBackgroundBlur > 0
    }
}
