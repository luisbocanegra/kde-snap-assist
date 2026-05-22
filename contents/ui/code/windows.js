function animateWindowPreviewToSelect(index, client){
    if (!immersiveMode) {
        selectClient(client);
        onClientSelect(client);
        return;
    }

    visibleWindowPreviews = [...visibleWindowPreviews, client];

    const item = windowPreviewsRepeater.itemAt(visibleWindowPreviews.length - 1);
    const thumbnail = clientsRepeater.itemAt(index);

    if (!item || !thumbnail) return;
    if (client.minimized) thumbnail.opacity = 1.0;
    const thumbnailGlobalCoords = thumbnail.mapToGlobal(0,0);

    /// set preview to fit corresponding thumbnail
    transitionDuration = 0;
    item.x = thumbnailGlobalCoords.x + 3 - minDx;
    item.y = thumbnailGlobalCoords.y + 32 - minDy;
    item.height = cardHeight - 40;
    item.width = cardWidth - 6;
    transitionDuration = transitionDurationOnAssistMove;

    timer.setTimeout(function(){
        /// animate to selected new size
        item.x = mainWindow.x - (assistPadding / 2);
        item.y = mainWindow.y - (assistPadding / 2);
        item.width = mainWindow.width + assistPadding,
        item.height = mainWindow.height + assistPadding;

        /// actually select client
        selectClient(client);
        timer.setTimeout(function(){
            onClientSelect(client);
        }, transitionDuration);
    }, 3);
}

function selectClient(client){
    client.setMaximize(false, false);
    client.shade = false;
    client.minimized = false;

    if (rememberWindowSizes)
        windowSizesBeforeSnap[client.internalId] = { height: client.height, width: client.width };

    if (currentTargetTile) {
        /// Assign the tile and let KWin position the window via its internal
        /// tile system. The setter (setTileCompatibility) triggers a
        /// moveResize to windowGeometry (= absolute bounds inset by padding).
        /// Setting frameGeometry first would lock the window flush against
        /// the bounds and skip the padding step entirely.
        client.tile = currentTargetTile;
    } else {
        /// Fallback when no tile matched: place via raw frameGeometry.
        client.frameGeometry = immersiveMode ? Qt.rect(
            mainWindow.x - (assistPadding / 2) + minDx,
            mainWindow.y - (assistPadding / 2) + minDy,
            mainWindow.width + assistPadding,
            mainWindow.height + assistPadding
        ) : Qt.rect(
            main.x - (assistPadding / 2),
            main.y - (assistPadding / 2),
            main.width + assistPadding,
            main.height + assistPadding
        );
    }
}

function onClientSelect(client){
    KWinComponents.Workspace.activeWindow = client;

    if (trackSnappedWindows) {
        removeWindowFromTrack(client.internalId); /// remove from track if was previously snapped
        snappedWindows.push(client.internalId);
    }

    AssistManager.checkToShowNextQuaterAssist(client);
}


/// listeners
function addListenersToClient(client) {
    if (!client || client.specialWindow || client.skipSwitcher) return;

    client.frameGeometryChanged.connect(function() {
        if (!client.move && !client.resize && activated == false && preventFromShowing == false) {
            if (delayBeforeShowingAssist == 0) {
                onWindowResize(client);
            } else {
                timer.setTimeout(function(){
                    onWindowResize(client);
                }, delayBeforeShowingAssist);
            }
        }
    });

    /// Plasma 6: the QML `tile` property's NOTIFY (`tileChanged`) only fires when
    /// the committed tile changes, but Shift+drag drops set `requestedTile` —
    /// which doesn't trigger `tileChanged`. interactiveMoveResizeFinished is the
    /// reliable hook: after drag ends, if window.tile is set, the window was
    /// dropped into a tile.
    if (client.interactiveMoveResizeFinished) {
        client.interactiveMoveResizeFinished.connect(function(){
            if (activated || preventFromShowing) return;
            if (!client.tile) return; /// not dropped into a tile
            if (delayBeforeShowingAssist == 0) {
                onTileChanged(client);
            } else {
                timer.setTimeout(function(){ onTileChanged(client); }, delayBeforeShowingAssist);
            }
        });
    }

    /// Fallback: still wire tileChanged in case some KWin paths emit it.
    if (client.tileChanged) {
        client.tileChanged.connect(function() {
            if (activated || preventFromShowing) return;
            if (delayBeforeShowingAssist == 0) {
                onTileChanged(client);
            } else {
                timer.setTimeout(function(){ onTileChanged(client); }, delayBeforeShowingAssist);
            }
        });
    }

    client.interactiveMoveResizeStarted.connect(function(){
        if (trackSnappedWindows && !client.resize)
            removeWindowFromTrack(client.internalId, function(group){
                if (fillOnSnappedMove) fillClosedWindow(client, group);
            });

        if (rememberWindowSizes){
            const storedSize = windowSizesBeforeSnap[client.internalId];
            if (storedSize) {
                client.frameGeometry.height = windowSizesBeforeSnap[client.internalId].height ?? client.height;
                client.frameGeometry.width = windowSizesBeforeSnap[client.internalId].width ?? client.width;
                delete windowSizesBeforeSnap[client.internalId];
            }
        }
    });

    client.closed.connect(function(window){
        handleWindowClose(client);
    });

    client.desktopsChanged.connect(function(){
        if (trackSnappedWindows && !client.resize) removeWindowFromTrack(client.internalId);
    });

    client.minimizedChanged.connect(function (cl) {
        if (!trackSnappedWindows || !minimizeSnappedTogether) return;
        if (cl.minimized) {
            WindowManager.applyActionToAssosiatedSnapGroup(client, function(cl){ if (cl) cl.minimized = true; });
        } else {
            WindowManager.applyActionToAssosiatedSnapGroup(client, function(cl) {
                if (cl) {
                    cl.minimized = false;
                    if (trackActiveWindows) {
                        const d = new Date();
                        activationTime[cl.internalId] = d.getTime();
                    }
                }
            });
        }
    });

    // client.minimizedChanged.connect(function(c){
    //         if (!trackSnappedWindows || !minimizeSnappedTogether) return;
    //         WindowManager.applyActionToAssosiatedSnapGroup(client, function(cl) {
    //             if (cl) {
    //                 cl.minimized = false;
    //                 if (trackActiveWindows) {
    //                     const d = new Date();
    //                     activationTime[cl.internalId] = d.getTime();
    //                 }
    //             }
    //         });
    // });
}

function onWindowResize(window) {
    if (activated || !window || window.deleted || window.specialWindow || !window.active) return;
    /// On Plasma 6, snaps assign a tile object — let onTileChanged handle those.
    if (window.tile) return;
    AssistManager.finishSnap(false); /// make sure we cleared all variables

    /// don't show assist if window could be fit in the group behind
    if (fitWindowInGroupBehind && windowFitsInSnapGroup(window)) return;
    const maxArea = KWinComponents.Workspace.clientArea(KWin.MaximizeArea, window);
    /// Ceil work-area origin so fractional scaling doesn't shave a pixel off
    /// the placed window (would otherwise sit under the panel).
    currentScreenWidth = Math.floor(maxArea.width); currentScreenHeight = Math.floor(maxArea.height);
    minDx = Math.ceil(maxArea.x); minDy = Math.ceil(maxArea.y);
    const dx = window.x, dy = window.y;
    const width = window.width, height = window.height;
    const halfScreenWidth = currentScreenWidth / 2, halfScreenHeight = currentScreenHeight / 2;

      /// store current window for animation
    if (immersiveMode) {
        currentWindowId = window.internalId;
        currentWindowPreview.x = window.x - minDx;
        currentWindowPreview.y = window.y - minDy;
        currentWindowPreview.width = window.width;
        currentWindowPreview.height = window.height;
    }

    /// Detect if window was snapped
    /// left/right halves
    if (isEqual(width, halfScreenWidth) && isEqual(height, currentScreenHeight) && isEqual(dy, minDy)) {
        if (isEqual(dx, minDx)) {
            /// show on right half
            AssistManager.delayedShowAssist(minDx + window.width, window.y, undefined, undefined, window);
        } else if (isEqual(dx, minDx + halfScreenWidth)) {
            /// show on left half
            AssistManager.delayedShowAssist(minDx, minDy, undefined, undefined, window);
        }
        columnsCount = 2;
        layoutMode = 0;
        filteredClients.push(window);

    /// top/bottom halves
    } else if (isEqual(width, currentScreenWidth) && isEqual(height, halfScreenHeight) && isEqual(dx, minDx)) {
        if (isEqual(dy, minDy)) {
            /// show in bottom half
            AssistManager.delayedShowAssist(minDx, minDy + halfScreenHeight, halfScreenHeight, currentScreenWidth);
        } else if (isEqual(dy, minDy + halfScreenHeight)) {
            /// show in top half
            AssistManager.delayedShowAssist(minDx, minDy, halfScreenHeight, currentScreenWidth);
        }
        columnsCount = 3;
        layoutMode = 2;
        filteredClients.push(window);
    }

    /// quater tiling
    else if (isEqual(width, halfScreenWidth) && isEqual(height, halfScreenHeight)) {
        /// define current screen quaters
            quatersToShowNext = {
            0: { dx: minDx, dy:  minDy, height: halfScreenHeight, width: halfScreenWidth, },
            1: { dx: minDx + halfScreenWidth, dy:  minDy, height: halfScreenHeight, width: halfScreenWidth, },
            2: { dx: minDx, dy: minDy + halfScreenHeight, height: halfScreenHeight, width: halfScreenWidth, },
            3: { dx: minDx + halfScreenWidth, dy:  minDy + halfScreenHeight, height: halfScreenHeight, width: halfScreenWidth, },
        };

        /// detect which quater snapped window takes
        let currentQuater = -1;
        let l = Object.keys(quatersToShowNext).length;

        for (let i = 0; i < l; i++) {
            const quater = quatersToShowNext[i];
            if (isEqual(dx, quater.dx) && isEqual(dy, quater.dy)) {
                currentQuater = i;
                delete quatersToShowNext[i];
                break;
            }
        }

        /// show snap assist in next quater
        if (currentQuater == -1) return;
        AssistManager.checkToShowNextQuaterAssist(window);
        layoutMode = 1;
        columnsCount = 2;
    }

    /// 3-in-row tiling
    else if (isEqual(height, currentScreenHeight)) {
        const thirdOfScreenWidth = currentScreenWidth / 3;
        if (isEqual(width, thirdOfScreenWidth)) {
            /// define current screen thirds
            quatersToShowNext = {
                0: { dx: minDx, dy:  minDy, height: currentScreenHeight, width: thirdOfScreenWidth, },
                1: { dx: minDx + thirdOfScreenWidth, dy:  minDy, height: currentScreenHeight, width: thirdOfScreenWidth, },
                2: { dx: minDx + (thirdOfScreenWidth * 2), dy: minDy, height: currentScreenHeight, width: thirdOfScreenWidth, },
            };

            /// detect which quater snapped window takes
            let currentQuater = -1;
            let l = Object.keys(quatersToShowNext).length;

            for (let i = 0; i < l; i++) {
                const quater = quatersToShowNext[i];
                if (isEqual(dx, quater.dx) && isEqual(dy, quater.dy)) {
                    currentQuater = i;
                    delete quatersToShowNext[i];
                    break;
                }
            }

            /// show snap assist in next quater
            if (currentQuater == -1) return;
            AssistManager.checkToShowNextQuaterAssist(window);
            layoutMode = 3;
            columnsCount = 1;
        }
    }

    /// if only one window available, show it in center and bigger
    if (clients && clients.length == 1) {
        columnsCount = 1;
        cardWidth *= 1.2;
        cardHeight *= 1.2;
    }
}

/// Plasma 6 tile-aware snap detection. Triggered when a window enters/leaves a Tile.
/// Strategy: compute empty regions geometrically (work area minus the snapped
/// window's frame), then try to match each empty strip to a real Tile in the
/// parent's subtree so we can use Tile.manage() for placement; otherwise fall
/// back to plain frameGeometry placement.
function onTileChanged(window) {
    if (activated || !window || window.deleted || window.specialWindow || !window.active) return;
    const tile = window.tile;
    if (!tile) return;

    AssistManager.finishSnap(false);

    const maxArea = KWinComponents.Workspace.clientArea(KWin.MaximizeArea, window);
    currentScreenWidth = Math.floor(maxArea.width); currentScreenHeight = Math.floor(maxArea.height);
    minDx = Math.ceil(maxArea.x); minDy = Math.ceil(maxArea.y);

    const wx0 = maxArea.x, wy0 = maxArea.y;
    const wx1 = maxArea.x + maxArea.width, wy1 = maxArea.y + maxArea.height;

    function _rectsOverlap(a, b) {
        return !(a.x + a.width  <= b.x || a.x >= b.x + b.width ||
                 a.y + a.height <= b.y || a.y >= b.y + b.height);
    }
    function _tileIsEmpty(t) {
        if (t.windows && t.windows.length > 0) return false;
        if (t.tiles && t.tiles.length > 0) {
            for (let i = 0; i < t.tiles.length; i++) {
                if (!_tileIsEmpty(t.tiles[i])) return false;
            }
        }
        return true;
    }

    /// "Occupied region" = bounding-box union of tile.geometry and window.frameGeometry.
    const _tg = tile.absoluteGeometryInScreen || tile.absoluteGeometry;
    const _fg = window.frameGeometry;
    let occRect;
    if (_tg && _fg) {
        const x0 = Math.min(_tg.x, _fg.x), y0 = Math.min(_tg.y, _fg.y);
        const x1 = Math.max(_tg.x + _tg.width,  _fg.x + _fg.width);
        const y1 = Math.max(_tg.y + _tg.height, _fg.y + _fg.height);
        occRect = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
    } else {
        occRect = _fg || _tg;
    }

    /// Decide which strategy to use:
    ///  - If the dropped tile has clean non-overlapping siblings (typical
    ///    custom tile layouts), iterate parent.tiles directly so each sibling
    ///    becomes its own chooser entry with its own Tile reference. This is
    ///    what lets KWin's tile system apply padding when the user picks one.
    ///  - Otherwise (Plasma's quick-tile tree where halves/corners/strips all
    ///    overlap), compute the empty region geometrically as work-area minus
    ///    the dropped window's frame.
    const parent = tile.parent;
    const siblings = parent && parent.tiles;
    let useTileTree = false;
    if (parent && siblings && siblings.length >= 2) {
        useTileTree = true;
        outer: for (let i = 0; i < siblings.length; i++) {
            const a = siblings[i].absoluteGeometryInScreen || siblings[i].absoluteGeometry;
            if (!a) continue;
            for (let j = i + 1; j < siblings.length; j++) {
                const b = siblings[j].absoluteGeometryInScreen || siblings[j].absoluteGeometry;
                if (b && _rectsOverlap(a, b)) { useTileTree = false; break outer; }
            }
        }
    }

    quatersToShowNext = {};
    let idx = 0;

    if (useTileTree) {
        /// Iterate parent.tiles directly. We do NOT check overlap against the
        /// dropped window's bounding box — useTileTree only triggers when
        /// siblings are non-overlapping by definition, and KWin can place the
        /// dropped window a hair outside its own tile (padding rounding) which
        /// then erroneously filters a legitimate empty sibling.
        for (let i = 0; i < siblings.length; i++) {
            const sib = siblings[i];
            if (sib === tile) continue;
            if (!_tileIsEmpty(sib)) continue; /// don't suggest already-occupied tiles
            const g = sib.absoluteGeometryInScreen || sib.absoluteGeometry;
            if (!g) continue;
            const cx0 = Math.ceil(Math.max(g.x, wx0));
            const cy0 = Math.ceil(Math.max(g.y, wy0));
            const cx1 = Math.floor(Math.min(g.x + g.width,  wx1));
            const cy1 = Math.floor(Math.min(g.y + g.height, wy1));
            if (cx1 <= cx0 || cy1 <= cy0) continue;
            quatersToShowNext[idx++] = {
                dx: cx0, dy: cy0, width: cx1 - cx0, height: cy1 - cy0, _tile: sib,
            };
        }
    } else {
        /// Geometric complement = work area minus the occupied rect (clipped).
        const occX0 = Math.max(occRect.x, wx0);
        const occY0 = Math.max(occRect.y, wy0);
        const occX1 = Math.min(occRect.x + occRect.width,  wx1);
        const occY1 = Math.min(occRect.y + occRect.height, wy1);
        const strips = [];
        if (occY0 > wy0) strips.push({ x: wx0, y: wy0, width: wx1 - wx0, height: occY0 - wy0 });
        if (occY1 < wy1) strips.push({ x: wx0, y: occY1, width: wx1 - wx0, height: wy1 - occY1 });
        if (occX0 > wx0) strips.push({ x: wx0, y: occY0, width: occX0 - wx0, height: occY1 - occY0 });
        if (occX1 < wx1) strips.push({ x: occX1, y: occY0, width: wx1 - occX1, height: occY1 - occY0 });
        for (const s of strips) {
            const cx0 = Math.ceil(s.x), cy0 = Math.ceil(s.y);
            const cx1 = Math.floor(s.x + s.width), cy1 = Math.floor(s.y + s.height);
            if (cx1 <= cx0 || cy1 <= cy0) continue;
            quatersToShowNext[idx++] = {
                dx: cx0, dy: cy0, width: cx1 - cx0, height: cy1 - cy0, _tile: null,
            };
        }
    }

    if (idx === 0) return;

    filteredClients.push(window);
    layoutMode = 1;
    columnsCount = 2;
    AssistManager.checkToShowNextQuaterAssist(window);
}

function handleWindowFocus(window) {
    if (ignoreFocusChange) return;
    if (activated) AssistManager.hideAssist(false);
    if (!window || window.specialWindow || window.skipSwitcher) return;

    /// Store timestamp of last window activation
    if (trackActiveWindows) {
        const d = new Date();
        activationTime[window.internalId] = d.getTime();
    }

    /// Raise all snapped windows together
    if (trackSnappedWindows && raiseSnappedTogether && !activated) {
        const i = snappedWindowGroups.findIndex((group) => group.windows.includes(window.internalId));
        if (i > -1) {
            ignoreFocusChange = true;
            const windows = snappedWindowGroups[i].windows;
            const l = windows.length;
            if (l < 2) return;

            for(let i = 0; i < l; i++) {
                if (windows[i] !== window.internalId) {
                    const w = getClientFromId(windows[i]);
                    if (w && !w.minimized) KWinComponents.Workspace.activeWindow = w;
                }
            }

            KWinComponents.Workspace.activeWindow = window;
            timer.setTimeout(function(){
                ignoreFocusChange = false;
            }, 100);
        }
    }
}

function handleWindowClose(window){
    if (!window || window.specialWindow) return;
    if (trackActiveWindows) delete activationTime[window.internalId];
    if (rememberWindowSizes) delete windowSizesBeforeSnap[window.internalId];

    if (trackSnappedWindows) {
        /// remove window if it was snapped
        removeWindowFromTrack(window.internalId, function(group){
            /// callback when snapped window was closed.
            if (fillOnSnappedClose) fillClosedWindow(window, group);
        });
    }
}


/// for snap groups
function applyActionToAssosiatedSnapGroup(client, callback){
    if (!client || !client.internalId) return;

    const i = snappedWindowGroups.findIndex((group) => group.windows.includes(client.internalId));
    if (i > -1) {
        const windows = snappedWindowGroups[i].windows;
        windows.forEach(windowId => callback(getClientFromId(windowId)));
    }
}

function removeWindowFromTrack(windowId, callback){
    /// Removes provided windowId from tracking of snapped windows
    if (!windowId) return;

    let i2 = -1;
    const i = snappedWindowGroups.findIndex(function(group) {
        i2 = group.windows.indexOf(windowId);
        return i2 > -1;
    });

    if (i > -1) {
        snappedWindowGroups[i].windows.splice(i2, 1);
        if (callback) callback(snappedWindowGroups[i]);
        const remainingWindowsCount = snappedWindowGroups[i].windows.length;
        if (remainingWindowsCount < 1) snappedWindowGroups.splice(i, 1); /// delete empty group
        else if (remainingWindowsCount === 1) {
            /// set timer to delete group if not populated in few seconds

            const remainingWindowId = snappedWindowGroups[i].windows[0];
            setOneTimeTimeout(function(){
                /// group index may have changed
                const i3 = snappedWindowGroups.findIndex((group) => group.windows.indexOf(remainingWindowId) > -1 && group.windows.length < 2);
                if (i3 > -1) snappedWindowGroups.splice(i3, 1);
            }, 6000);
        }
    }
}

function fillClosedWindow(closedWindow, group){
    /// fill the free area when snapped window closed or moved
    const closedWindowGeom = closedWindow.frameGeometry;
    const remainingWindows = group.windows;
    for(let i = 0, l = remainingWindows.length; i < l; i++){
        const window = getClientFromId(remainingWindows[i]);
        if (!window) continue;
        if (window.internalId == closedWindow.internalId) continue;
        const windowGeom = window.frameGeometry;
        if (!windowGeom) continue;

        /// special handling for 3-in-row layout
        /// when closed 3rd window, we don't want the first one to try filling it
        if (closedWindowGeom.width == currentScreenWidth / 3 && closedWindowGeom.x == minDx + (currentScreenWidth / 3 * 2))
            if (windowGeom.width == currentScreenWidth / 3 && windowGeom.x == minDx) continue;

        if (windowGeom.x == closedWindowGeom.x && windowGeom.width == closedWindowGeom.width){
            /// expand vertically
            AssistManager.preventAssistFromShowing();
            let newHeight = windowGeom.height + closedWindowGeom.height;
            if (newHeight > currentScreenHeight) newHeight = currentScreenHeight;
            window.frameGeometry = Qt.rect(windowGeom.x,
                                           windowGeom.y - (windowGeom.y > closedWindowGeom.y ? closedWindowGeom.height : 0),
                                           windowGeom.width, newHeight);
            break;
        } else if(windowGeom.y == closedWindowGeom.y && windowGeom.height == closedWindowGeom.height) {
            /// expand horizontally
            AssistManager.preventAssistFromShowing();
            let newWidth = windowGeom.width + closedWindowGeom.width;
            if (newWidth > currentScreenWidth) newWidth = currentScreenWidth;
            window.frameGeometry = Qt.rect(
                windowGeom.x - (windowGeom.x > closedWindowGeom.x ? closedWindowGeom.width : 0),
                windowGeom.y, newWidth, windowGeom.height);
            break;
        }
    }
}

function windowFitsInSnapGroup(client){
    /// determines if newly snapped window could be fit in group behind it
    /// requires track activation time and raise snapped windows together

    /// find last active client
    let lastActiveWindowId = -1, lastActiveTime = -1;
    const activeClientId = KWinComponents.Workspace.activeWindow ? KWinComponents.Workspace.activeWindow.internalId : null;
    Object.keys(activationTime).forEach(function(key) {
        if(activationTime[key] > lastActiveTime && key != client.internalId && key != activeClientId) {
            const c = getClientFromId(key);
            if (c && !c.minimized && c.output == KWinComponents.Workspace.activeScreen && !c.desktops.length || c.desktops.includes(KWinComponents.Workspace.currentDesktop)) {
                lastActiveWindowId = c.internalId;
                lastActiveTime = activationTime[key];
            }
        }
    });
    if (lastActiveWindowId < 0) return false;

    /// find if it belongs to snap group
    const indexOfGroup = snappedWindowGroups.findIndex((group) => group.windows.includes(lastActiveWindowId));
    if (indexOfGroup < 0) return false;

    /// check rest of windows in that group
    const snappedWindows = snappedWindowGroups[indexOfGroup].windows;
    let intercectsWithAnyOtherWindow = false;

    for (let i = 0, l = snappedWindows.length; i < l; i++) {
        const w = getClientFromId(snappedWindows[i]);
        if (!w) continue;

        if (w.y == client.y && w.height == client.height && w.width > client.width) {
            /// reduce window width to fit new window in layout
            snappedWindowGroups[indexOfGroup].windows.push(client.internalId);
            AssistManager.preventAssistFromShowing();
            const newWidth = w.frameGeometry.width - client.width;
            w.frameGeometry = Qt.rect(w.frameGeometry.x + (w.x == client.x ? client.width : 0), w.frameGeometry.y, newWidth, w.frameGeometry.height);
            return true;

        } else if (w.x == client.x && w.width == client.width && w.height > client.height) {
            /// reduce window height to fit new window in layout
            snappedWindowGroups[indexOfGroup].windows.push(client.internalId);
            AssistManager.preventAssistFromShowing();
            const newHeight = w.frameGeometry.height - client.height;
            w.frameGeometry = Qt.rect(w.frameGeometry.x, w.frameGeometry.y + (w.y == client.y ? client.height : 0), w.frameGeometry.width, newHeight);
            return true;

        } else if (w.x == client.x && w.y == client.y && w.height == client.height && w.width == client.width) {
            /// replace window in group with newly snapped window
            snappedWindowGroups[indexOfGroup].windows.splice(i, 1);
            snappedWindowGroups[indexOfGroup].windows.push(client.internalId);
            return true;
        }

        /// check if windows intercept
        if (intercectsWithAnyOtherWindow == false) {
            if (windowRectanglesIntersect(w.x, w.y, w.x + w.width, w.y + w.height, client.x, client.y, client.x + client.width, client.y + client.height)) {
                intercectsWithAnyOtherWindow = true;
            }
        }
    }

    /// if window does not intercect with other windows in the group, let it in
    if (intercectsWithAnyOtherWindow == false) {
        snappedWindowGroups[indexOfGroup].windows.push(client.internalId);
        AssistManager.preventAssistFromShowing();
        return true;
    }

    return false;
}


/// utility functions
function isEqual(a, b) {
    /// for compatibility with scripts like Window Gap
    return a - b <= snapDetectPrecision && a - b >= -snapDetectPrecision;
}

function getClientFromId(windowId){
    //return workspace.getClient(windowId); /// doesn't work on Wayland
    if (!allClients) {
        const _ws = KWinComponents.Workspace.windows;
        allClients = [];
        for (let i = 0; i < _ws.length; ++i) allClients.push(_ws[i]);
    }
    return allClients.find((el) => el.internalId == windowId);
}

function shouldShowWindow(client) {
    if (filteredClients.includes(client)) return false;
    if (client.active || client.specialWindow) return false;
    if (client.skipTaskbar || client.skipSwitcher || client.skipPager) return false;
    if (!showMinimizedWindows && client.minimized) return false;
    if (!showOtherScreensWindows && client.output !== KWinComponents.Workspace.activeScreen) return false;
    if (!showOtherDesktopsWindows && !client.desktops.length || !client.desktops.includes(KWinComponents.Workspace.currentDesktop)) return false;
    if (!showSnappedWindows && snappedWindowGroups.findIndex(group => group.windows.includes(client.internalId) && group.windows.length > 1) > -1) return false;
    if (client.activities.length > 0 && !client.activities.includes(KWinComponents.Workspace.currentActivity)) return false;
    return true;
}

function sortClientsByLastActive() {
    clients = clients.sort(function(a, b) {
        const windowIdA = a.internalId, windowIdB = b.internalId;
        if (activationTime[windowIdA] && !activationTime[windowIdB]) return 1;
        if (!activationTime[windowIdA] && activationTime[windowIdB]) return -1;
        return activationTime[windowIdA] - activationTime[windowIdB];
    });
}

/// One-time timer, when we want multiple timers run in parallel
function setOneTimeTimeout(cb, delayTime){
    function Timer() {
        return Qt.createQmlObject("import QtQuick 2.0; Timer {}", main);
    }

    const timer = new Timer();
    timer.interval = delayTime;
    timer.repeat = false;
    timer.triggered.connect(function(){
        cb();
        timer.destroy();
    });
    timer.start();
}

function windowRectanglesIntersect(
    minAx, minAy, maxAx, maxAy,
    minBx, minBy, maxBx, maxBy) {
    const aLeftOfB = maxAx < minBx;
    const aRightOfB = minAx > maxBx;
    const aAboveB = minAy > maxBy;
    const aBelowB = maxAy < minBy;

    return maxAx > minBx && minAx < maxBx && minAy < maxBy && maxAy > minBy;
}
