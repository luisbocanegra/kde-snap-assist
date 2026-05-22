/// for keyboard navigation
function moveFocusLeft() {
    focusedIndex = focusedIndex - 1;
    if (focusedIndex < 0) focusedIndex = cycleKeyboard ? clients.length - 1 : 0;
    scrollItemIntoView(focusedIndex);
}

function moveFocusRight() {
    focusedIndex = focusedIndex + 1;
    const lastIndex = clients.length - 1;
    if (focusedIndex > lastIndex) focusedIndex = cycleKeyboard ? 0 : lastIndex;
    scrollItemIntoView(focusedIndex);
}

/// The chooser Grid computes its column count dynamically (capped by actual
/// candidate count and what fits in the chooser width). Up/down navigation
/// must use that effective value, not the static layout columnsCount, or a
/// single-column chooser tries to jump by 2 rows and the move is rejected.
function _effectiveColumns() {
    const fit = Math.floor((scrollView.width + gridSpacing) / (cardWidth + gridSpacing));
    return Math.max(1, Math.min(
        clients ? clients.length : 1,
        Math.min(columnsCount, fit)));
}

function moveFocusUp(){
    const cols = _effectiveColumns();
    if(focusedIndex - cols >= 0) {
        focusedIndex = focusedIndex - cols;
        scrollItemIntoView(focusedIndex);
    }
}

function moveFocusDown(){
    const cols = _effectiveColumns();
    if(focusedIndex + cols < clients.length) {
        focusedIndex = focusedIndex + cols;
        scrollItemIntoView(focusedIndex);
    } else {
        focusedIndex =  clients.length - 1;
        scrollItemIntoView(focusedIndex);
    }
}

function scrollItemIntoView(index) {
    const dy = clientsRepeater.itemAt(index).y, viewHeight = mainWindow.height * 0.95;
    const scrollStep = (cardHeight + gridSpacing)  / scrollView.contentHeight;
    if (dy > viewHeight) scrollView.ScrollBar.vertical.position += scrollStep;
    else if (dy < scrollView.ScrollBar.vertical.position) scrollView.ScrollBar.vertical.position -= scrollStep;
}
