import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import Quickshell
import Quickshell.Io

Scope {
    id: root

    property bool panelVisible: false
    property bool loading: false
    property string errorMessage: ""
    property var entries: []
    property var groups: []
    property int pendingKillPid: -1
    property string pendingKillGroupKey: ""
    property bool rescanPending: false
    property bool scanOutputReceived: false
    property bool scanTimedOut: false

    readonly property bool killBusy: killProcess.running

    readonly property int panelWidth: 360
    readonly property int panelMinHeight: 152
    readonly property int panelMaxHeight: 488
    readonly property int listMaxHeight: 400
    readonly property int spaceXs: 4
    readonly property int spaceSm: 8
    readonly property int spaceMd: 12
    readonly property int spaceLg: 16
    readonly property int buttonSize: 32
    readonly property int rowHeight: 52
    readonly property int radiusSm: 6
    readonly property int radiusMd: 10
    readonly property color colorSurface: "#FF202022"
    readonly property color colorBorder: "#20F4F4F6"
    readonly property color colorText: "#F1F1F3"
    readonly property color colorMuted: "#A5A5AC"
    readonly property color colorSubtle: "#74747C"
    readonly property color colorDivider: "#18F4F4F6"
    readonly property color colorHover: "#0FF4F4F6"
    readonly property color colorActionHover: "#24F4F4F6"
    readonly property color colorFocus: "#91CFAD"
    readonly property color colorAlive: "#38C95B"
    readonly property color colorDanger: "#FF6B64"
    readonly property color colorDangerSoft: "#2AFF6B64"

    function groupEntries(items) {
        var result = []
        var indexes = {}
        for (var i = 0; i < items.length; i++) {
            var entry = items[i]
            var key = String(entry.groupKey || entry.projectName || "other")
            var indexKey = "$" + key
            var index = indexes[indexKey]
            if (index === undefined) {
                index = result.length
                indexes[indexKey] = index
                result.push({
                    key: key,
                    name: String(entry.projectName || entry.groupKey || "Other"),
                    items: []
                })
            }
            result[index].items.push(entry)
        }
        return result
    }

    function applyScan(output) {
        scanOutputReceived = true
        loading = false
        try {
            var payload = JSON.parse(output)
            if (!payload || !Array.isArray(payload.entries))
                throw new Error("missing entries")

            if (payload.error) {
                entries = []
                groups = []
                errorMessage = String(payload.error)
                return
            }

            entries = payload.entries
            groups = groupEntries(payload.entries)
            errorMessage = ""
        } catch (error) {
            console.warn("dev-tray: could not parse scanner output:", error)
            entries = []
            groups = []
            errorMessage = "Could not read the scanner response."
        }
    }

    function scan() {
        if (scanProcess.running) {
            rescanPending = true
            return
        }
        loading = true
        errorMessage = ""
        scanOutputReceived = false
        scanTimedOut = false
        scanTimeout.restart()
        scanProcess.exec(["dev-tray-linux", "scan"])
    }

    function startKill(pids) {
        if (killBusy || !pids.length)
            return
        pendingKillPid = -1
        pendingKillGroupKey = ""
        killConfirmTimer.stop()
        var command = ["dev-tray-linux", "kill"]
        for (var i = 0; i < pids.length; i++)
            command.push(String(pids[i]))
        killProcess.exec(command)
    }

    function requestKill(entry) {
        if (killBusy)
            return
        var pid = Number(entry.pid)
        if (pendingKillPid !== pid) {
            pendingKillPid = pid
            pendingKillGroupKey = ""
            killConfirmTimer.restart()
            return
        }
        startKill([pid])
    }

    function requestKillGroup(group) {
        if (killBusy)
            return
        var key = String(group.key)
        if (pendingKillGroupKey !== key) {
            pendingKillPid = -1
            pendingKillGroupKey = key
            killConfirmTimer.restart()
            return
        }
        var pids = []
        for (var i = 0; i < group.items.length; i++)
            pids.push(Number(group.items[i].pid))
        startKill(pids)
    }

    IpcHandler {
        target: "devTray"

        function toggle(): void {
            root.panelVisible = !root.panelVisible
            if (root.panelVisible)
                root.scan()
        }
    }

    Process {
        id: scanProcess

        stdout: StdioCollector {
            onStreamFinished: {
                if (text !== "")
                    root.applyScan(text)
            }
        }

        onExited: (exitCode, exitStatus) => {
            scanTimeout.stop()
            root.loading = false
            if (!root.scanTimedOut && exitCode !== 0 && !root.scanOutputReceived) {
                root.entries = []
                root.groups = []
                root.errorMessage = "Could not run dev-tray-linux. Check the graphical session PATH."
            }
            if (root.rescanPending && !root.scanTimedOut) {
                root.rescanPending = false
                Qt.callLater(function() { root.scan() })
            }
        }
    }

    Process {
        id: openProcess

        onExited: (exitCode, exitStatus) => {
            if (exitCode !== 0)
                root.errorMessage = "Could not open the server in your browser."
        }
    }

    Process {
        id: killProcess

        onExited: (exitCode, exitStatus) => {
            if (exitCode === 0)
                root.scan()
            else
                root.errorMessage = "Could not stop the selected server."
        }
    }

    Timer {
        interval: 5000
        repeat: true
        running: root.panelVisible
        onTriggered: {
            if (root.errorMessage === "")
                root.scan()
        }
    }

    Timer {
        id: scanTimeout
        interval: 15000
        onTriggered: {
            root.scanTimedOut = true
            root.rescanPending = false
            root.loading = false
            root.entries = []
            root.groups = []
            root.errorMessage = "The server scan timed out."
            scanProcess.running = false
        }
    }

    Timer {
        id: killConfirmTimer
        interval: 3000
        onTriggered: {
            root.pendingKillPid = -1
            root.pendingKillGroupKey = ""
        }
    }

    PanelWindow {
        id: panel
        visible: root.panelVisible
        implicitWidth: root.panelWidth
        implicitHeight: Math.min(root.panelMaxHeight,
                                 Math.max(root.panelMinHeight, surface.implicitHeight))
        color: "transparent"
        focusable: true
        exclusiveZone: 0
        onVisibleChanged: {
            if (visible)
                Qt.callLater(function() { keyFocus.forceActiveFocus() })
        }

        Item {
            id: keyFocus
            anchors.fill: parent
            focus: root.panelVisible
            Keys.onEscapePressed: root.panelVisible = false
        }

        anchors {
            top: true
            right: true
        }

        margins {
            top: root.spaceMd
            right: root.spaceMd
        }

        Rectangle {
            id: surface
            anchors.fill: parent
            implicitHeight: contentColumn.implicitHeight + root.spaceLg * 2
            color: root.colorSurface
            radius: root.radiusMd
            border.width: 1
            border.color: root.colorBorder
            clip: true
            opacity: root.panelVisible ? 1 : 0
            transform: Translate {
                y: root.panelVisible ? 0 : -6

                Behavior on y {
                    NumberAnimation {
                        duration: 140
                        easing.type: Easing.OutCubic
                    }
                }
            }

            Behavior on opacity {
                NumberAnimation {
                    duration: 140
                    easing.type: Easing.OutCubic
                }
            }

            ColumnLayout {
                id: contentColumn
                anchors {
                    left: parent.left
                    right: parent.right
                    top: parent.top
                    margins: root.spaceLg
                }
                spacing: root.spaceMd

                RowLayout {
                    Layout.fillWidth: true
                    implicitHeight: root.buttonSize
                    spacing: root.spaceSm

                    Label {
                        text: "Dev Tray"
                        color: root.colorText
                        font.family: "sans-serif"
                        font.pixelSize: 15
                        font.weight: Font.DemiBold
                    }

                    Label {
                        text: String(root.entries.length)
                        color: root.colorSubtle
                        font.family: "sans-serif"
                        font.pixelSize: 11
                        font.weight: Font.DemiBold
                        Accessible.name: root.entries.length === 1
                                         ? "1 active local server"
                                         : String(root.entries.length) + " active local servers"
                    }

                    Item { Layout.fillWidth: true }

                    BusyIndicator {
                        visible: root.loading
                        running: visible
                        implicitWidth: 18
                        implicitHeight: 18
                        palette.dark: root.colorMuted
                        Accessible.name: "Scanning for local servers"
                    }
                }

                Rectangle {
                    Layout.fillWidth: true
                    implicitHeight: 1
                    color: root.colorDivider
                }

                Item {
                    id: body
                    Layout.fillWidth: true
                    implicitHeight: root.errorMessage !== ""
                                    ? 104
                                    : root.entries.length === 0
                                      ? 80
                                      : Math.min(root.listMaxHeight, groupsColumn.implicitHeight)

                    Column {
                        anchors.centerIn: parent
                        width: parent.width
                        spacing: root.spaceSm
                        visible: root.loading && root.entries.length === 0 && root.errorMessage === ""

                        Label {
                            anchors.horizontalCenter: parent.horizontalCenter
                            text: "Scanning for local servers…"
                            color: root.colorMuted
                            font.family: "sans-serif"
                            font.pixelSize: 12
                        }
                    }

                    Column {
                        anchors.centerIn: parent
                        width: parent.width
                        spacing: root.spaceXs
                        visible: !root.loading && root.entries.length === 0 && root.errorMessage === ""

                        Label {
                            anchors.horizontalCenter: parent.horizontalCenter
                            text: "✓"
                            color: root.colorSubtle
                            font.family: "sans-serif"
                            font.pixelSize: 14
                            Accessible.name: "All clear"
                        }

                        Label {
                            anchors.horizontalCenter: parent.horizontalCenter
                            text: "All clear"
                            color: root.colorText
                            font.family: "sans-serif"
                            font.pixelSize: 13
                            font.weight: Font.DemiBold
                        }

                        Label {
                            anchors.horizontalCenter: parent.horizontalCenter
                            text: "No active local servers"
                            color: root.colorMuted
                            font.family: "sans-serif"
                            font.pixelSize: 11
                        }
                    }

                    Column {
                        anchors.centerIn: parent
                        width: parent.width
                        spacing: root.spaceSm
                        visible: root.errorMessage !== ""

                        Label {
                            anchors.horizontalCenter: parent.horizontalCenter
                            text: "Server scan failed"
                            color: root.colorDanger
                            font.family: "sans-serif"
                            font.pixelSize: 13
                            font.weight: Font.DemiBold
                        }

                        Label {
                            anchors.horizontalCenter: parent.horizontalCenter
                            width: parent.width - root.spaceLg * 2
                            text: root.errorMessage
                            color: root.colorMuted
                            font.family: "sans-serif"
                            font.pixelSize: 11
                            horizontalAlignment: Text.AlignHCenter
                            elide: Text.ElideRight
                        }

                        Button {
                            anchors.horizontalCenter: parent.horizontalCenter
                            implicitHeight: root.buttonSize
                            text: "Try again"
                            flat: true
                            onClicked: root.scan()
                            Accessible.name: "Scan again"

                            contentItem: Label {
                                text: parent.text
                                color: root.colorText
                                font.family: "sans-serif"
                                font.pixelSize: 11
                                font.weight: Font.DemiBold
                                horizontalAlignment: Text.AlignHCenter
                                verticalAlignment: Text.AlignVCenter
                            }

                            background: Rectangle {
                                radius: root.radiusSm
                                color: parent.hovered ? root.colorActionHover : "transparent"
                                border.width: parent.activeFocus ? 1 : 0
                                border.color: root.colorFocus
                            }
                        }
                    }

                    Flickable {
                        anchors.fill: parent
                        visible: root.errorMessage === "" && root.entries.length > 0
                        contentWidth: width
                        contentHeight: groupsColumn.implicitHeight
                        clip: true
                        boundsBehavior: Flickable.StopAtBounds
                        ScrollBar.vertical: ScrollBar {
                            policy: ScrollBar.AsNeeded
                        }

                        Column {
                            id: groupsColumn
                            width: parent.width

                            Repeater {
                                model: root.groups

                                delegate: Column {
                                    id: groupBlock
                                    required property var modelData
                                    property var group: modelData
                                    width: groupsColumn.width

                                    property bool grouped: group.items.length > 1
                                    property bool collapsed: false

                                    RowLayout {
                                        visible: groupBlock.grouped
                                        width: parent.width
                                        height: visible ? 32 : 0
                                        spacing: root.spaceSm

                                        Button {
                                            Layout.fillWidth: true
                                            implicitHeight: root.buttonSize
                                            flat: true
                                            text: (groupBlock.collapsed ? "▸ " : "▾ ")
                                                  + groupBlock.group.name
                                                  + " · " + String(groupBlock.group.items.length)
                                            onClicked: groupBlock.collapsed = !groupBlock.collapsed
                                            Accessible.name: (groupBlock.collapsed ? "Expand " : "Collapse ")
                                                             + groupBlock.group.name

                                            contentItem: Label {
                                                text: parent.text
                                                color: root.colorMuted
                                                font.family: "sans-serif"
                                                font.pixelSize: 11
                                                font.weight: Font.DemiBold
                                                horizontalAlignment: Text.AlignLeft
                                                verticalAlignment: Text.AlignVCenter
                                                elide: Text.ElideRight
                                            }

                                            background: Rectangle {
                                                radius: root.radiusSm
                                                color: parent.hovered ? root.colorActionHover : "transparent"
                                                border.width: parent.activeFocus ? 1 : 0
                                                border.color: root.colorFocus
                                            }
                                        }

                                        Button {
                                            id: groupKillButton
                                            property bool armed: root.pendingKillGroupKey === String(groupBlock.group.key)
                                            implicitWidth: root.buttonSize
                                            implicitHeight: root.buttonSize
                                            flat: true
                                            enabled: !root.killBusy
                                            text: armed ? "!" : "×"
                                            onClicked: root.requestKillGroup(groupBlock.group)
                                            Accessible.name: (armed ? "Confirm stopping " : "Stop ")
                                                             + String(groupBlock.group.items.length)
                                                             + " servers in " + groupBlock.group.name
                                            ToolTip.visible: hovered
                                            ToolTip.text: armed ? "Click again to stop this group"
                                                                       : "Stop group"

                                            contentItem: Label {
                                                text: parent.text
                                                color: groupKillButton.armed || groupKillButton.hovered
                                                       ? root.colorDanger
                                                       : root.colorMuted
                                                font.family: "sans-serif"
                                                font.pixelSize: groupKillButton.armed ? 14 : 19
                                                font.weight: groupKillButton.armed ? Font.Bold : Font.Normal
                                                horizontalAlignment: Text.AlignHCenter
                                                verticalAlignment: Text.AlignVCenter
                                            }

                                            background: Rectangle {
                                                radius: root.radiusSm
                                                color: groupKillButton.armed || groupKillButton.hovered
                                                       ? root.colorDangerSoft
                                                       : "transparent"
                                                border.width: parent.activeFocus ? 1 : 0
                                                border.color: groupKillButton.armed ? root.colorDanger : root.colorFocus
                                            }
                                        }
                                    }

                                    Repeater {
                                        model: groupBlock.collapsed ? [] : groupBlock.group.items

                                        delegate: Rectangle {
                                            id: serverRow
                                            required property var modelData
                                            property var entry: modelData
                                            width: groupBlock.width
                                            height: root.rowHeight
                                            color: rowHover.hovered ? root.colorHover : "transparent"

                                            HoverHandler {
                                                id: rowHover
                                            }

                                            Rectangle {
                                                anchors.top: parent.top
                                                width: parent.width
                                                height: 1
                                                color: root.colorDivider
                                            }

                                            RowLayout {
                                                anchors.fill: parent
                                                spacing: root.spaceSm

                                                Rectangle {
                                                    implicitWidth: 6
                                                    implicitHeight: 6
                                                    radius: 3
                                                    color: serverRow.entry.health === "alive" ? root.colorAlive
                                                           : serverRow.entry.health === "dead" ? root.colorDanger
                                                           : root.colorSubtle
                                                    Accessible.name: serverRow.entry.health === "alive"
                                                                     ? "Server healthy"
                                                                     : serverRow.entry.health === "dead"
                                                                       ? "Server unhealthy"
                                                                       : "Server health unknown"
                                                }

                                                ColumnLayout {
                                                    Layout.fillWidth: true
                                                    spacing: 0

                                                    RowLayout {
                                                        Layout.fillWidth: true
                                                        spacing: root.spaceXs

                                                        Label {
                                                            visible: !groupBlock.grouped
                                                            Layout.fillWidth: visible
                                                            text: groupBlock.group.name + " ·"
                                                            color: root.colorText
                                                            font.family: "sans-serif"
                                                            font.pixelSize: 13
                                                            font.weight: Font.DemiBold
                                                            elide: Text.ElideRight
                                                        }

                                                        Label {
                                                            text: ":" + String(serverRow.entry.port)
                                                            color: root.colorText
                                                            font.family: "monospace"
                                                            font.pixelSize: 15
                                                            font.weight: Font.DemiBold
                                                        }
                                                    }

                                                    Label {
                                                        Layout.fillWidth: true
                                                        text: {
                                                            var framework = String(serverRow.entry.framework || "")
                                                            var branch = String(serverRow.entry.branchCurrent || "")
                                                            var detail = framework && branch
                                                                    ? framework + " · " + branch
                                                                    : framework || branch
                                                            if (serverRow.entry.branchDrifted)
                                                                detail += (detail ? " · " : "") + "branch changed"
                                                            return detail
                                                        }
                                                        visible: text !== ""
                                                        color: root.colorMuted
                                                        font.family: "sans-serif"
                                                        font.pixelSize: 10
                                                        elide: Text.ElideRight
                                                    }
                                                }

                                                Button {
                                                    id: openButton
                                                    implicitWidth: root.buttonSize
                                                    implicitHeight: root.buttonSize
                                                    flat: true
                                                    enabled: !openProcess.running
                                                    text: "↗"
                                                    onClicked: openProcess.exec(["dev-tray-linux", "open",
                                                                                 String(serverRow.entry.port)])
                                                    Accessible.name: "Open " + groupBlock.group.name
                                                                     + " on port " + String(serverRow.entry.port)
                                                    ToolTip.visible: hovered
                                                    ToolTip.text: "Open in browser"

                                                    contentItem: Label {
                                                        text: parent.text
                                                        color: openButton.hovered ? root.colorText : root.colorMuted
                                                        font.family: "sans-serif"
                                                        font.pixelSize: 17
                                                        horizontalAlignment: Text.AlignHCenter
                                                        verticalAlignment: Text.AlignVCenter
                                                    }

                                                    background: Rectangle {
                                                        radius: root.radiusSm
                                                        color: parent.hovered ? root.colorActionHover : "transparent"
                                                        border.width: parent.activeFocus ? 1 : 0
                                                        border.color: root.colorFocus
                                                    }
                                                }

                                                Button {
                                                    id: killButton
                                                    property bool armed: root.pendingKillPid === Number(serverRow.entry.pid)
                                                    implicitWidth: root.buttonSize
                                                    implicitHeight: root.buttonSize
                                                    flat: true
                                                    enabled: !root.killBusy
                                                    text: armed ? "!" : "×"
                                                    onClicked: root.requestKill(serverRow.entry)
                                                    Accessible.name: (armed ? "Confirm stopping " : "Stop ")
                                                                     + groupBlock.group.name
                                                                     + " on port " + String(serverRow.entry.port)
                                                    ToolTip.visible: hovered
                                                    ToolTip.text: armed ? "Click again to stop"
                                                                       : "Stop server"

                                                    contentItem: Label {
                                                        text: parent.text
                                                        color: killButton.armed || killButton.hovered
                                                               ? root.colorDanger
                                                               : root.colorMuted
                                                        font.family: "sans-serif"
                                                        font.pixelSize: killButton.armed ? 14 : 19
                                                        font.weight: killButton.armed ? Font.Bold : Font.Normal
                                                        horizontalAlignment: Text.AlignHCenter
                                                        verticalAlignment: Text.AlignVCenter
                                                    }

                                                    background: Rectangle {
                                                        radius: root.radiusSm
                                                        color: killButton.armed || killButton.hovered
                                                               ? root.colorDangerSoft
                                                               : "transparent"
                                                        border.width: parent.activeFocus ? 1 : 0
                                                        border.color: killButton.armed ? root.colorDanger : root.colorFocus
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
