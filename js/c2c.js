'use strict';

/*
   Voice Team - Click to Call Widget (SDK 1.21.0)

   Call a specific user set in configuration file,
          other option - set user as URL parameter (with possible DTMF keys sequence)
   
   Call type: 'audio' audio only call
              'video' video call
              'user_control' audio or video call (selected by checkbox),
                             camera can be switched on/off during call,
                             allowed re-INVITE with added video.

   Optional voice test call to check connection quality with SBC.
   The widget can be loaded from HTTPS server (or from local file)
   
   Based on AudioCodes Click-to-Call by Igor Kolosov.
   Redesigned as Voice Team.
 */
const c2c_userAgent = 'Voice Team Click-to-Call';
const c2c_sbcDisconnectCounterMax = 5;
const c2c_sbcDisconnectDelay = 60;   // After call termination keep SBC connection the time interval (seconds)

let c2c_phone = new AudioCodesUA(); // phone API
let c2c_ac_log = console.log;       // phone logger
let c2c_hasMicrophone = true;
let c2c_hasCamera = false;
let c2c_audioPlayer = new AudioPlayer2();
let c2c_activeCall = null; // not null, if exists active call
let c2c_restoreCall = null;
let c2c_sbcDisconnectCounter = 0;
let c2c_sbcDisconnectTimer = null;
let c2c_messageId = 0;
let c2c_streamDest = null;      // Audio player stream destination (to play recorded sound during test call)
let c2c_usedTurnServer = false; // If TURN server set in configuration ?
let c2c_isWsConnected = false;  // Is websocket connected to SBC ? 
let c2c_isStartCall = false;    // start call after SBC connection.
let c2c_dtmfSequence = null;    // send DTMF sequence after connection.
let c2c_dtmfDelay = 2000;       // delay (milliseconds) before DTMF sending.
let c2c_callButtonHandler = function () { };
let c2c_callButtonTitle = null;
let c2c_x_header = null;        // optional x header added to INVITE.
let c2c_token = null;
let c2c_devices = null;         // optional select devices feature, not for all OS/browsers.
let c2c_remoteVideoDeviceId = undefined; // last associated deviceId
let c2c_isSelfVideo = false;
let c2c_screenSharingStream = null;

// HTML element references

// Block of call buttons.
let c2c_widgetDiv = null;

// Select devices button. Used if selectDevicesEnabled in config.js
let c2c_selectDevicesButton = null;

// Keypad. Used if dtmfKeypadEnabled in config.js
let c2c_keypadButton = null;
let c2c_keypadDiv = null;

// Call button - the same button used as call and hangup button.
let c2c_callButton = null;

// If call type is 'user_control' before call show video checkbox
let c2c_videoSpan = null;
let c2c_videoCheckbox = null;

// If call type is 'user_control' during call show camera button
let c2c_cameraButton = null;
let c2c_cameraLineSvg = null;

// Select devices div 
let c2c_selectDevicesDiv = null;

// Status line.
let c2c_status_line = null;

// Video element 
let c2c_localVideo = null;
let c2c_remoteVideo = null;

// Optional show yourself
let c2c_selfVideoSpan = null;
let c2c_selfVideoChk = null;

// Optional screen sharing.
let c2c_screenSharingButton = null;

// Settings panel elements
let c2c_settingsButton = null;
let c2c_settingsModal = null;
let c2c_settingsCloseBtn = null;
let c2c_settingsSaveBtn = null;

// Auth (login/logout) elements
let c2c_loginBtn = null;
let c2c_userBtn = null;
let c2c_userMenuModal = null;
let c2c_userMenuCloseBtn = null;
let c2c_logoutBtn = null;

// Device test elements
let c2c_deviceTestBtn = null;
let c2c_deviceTestDiv = null;
let c2c_deviceTestCloseBtn = null;
let c2c_cameraPreview = null;
let c2c_cameraPreviewPlaceholder = null;
let c2c_cameraPreviewBtn = null;
let c2c_micTestBtn = null;
let c2c_micLevelFill = null;
let c2c_micLevelText = null;
let c2c_speakerTestBtn = null;
let c2c_speakerTestResult = null;

let c2c_cameraPreviewStream = null;
let c2c_micTestStream = null;
let c2c_micAnalyser = null;
let c2c_micTestActive = false;
let c2c_micTestRaf = null;

// Debug panel elements
let c2c_debugBtn = null;
let c2c_debugPanel = null;
let c2c_debugLog = null;
let c2c_debugCloseBtn = null;
let c2c_debugClearBtn = null;
let c2c_debugCopyBtn = null;
let c2c_debugStatusEl = null;
let c2c_debugDiagBtn = null;
let c2c_debugVisible = false;
let c2c_debugEntries = [];
let c2c_originalLog = null;

// Set logger: console or websocket.
function c2c_init() {
    let logger = c2c_getStrUrlParameter('logger');
    if (!logger)
        logger = c2c_serverConfig.logger;

    if (!logger) {
        c2c_setConsoleLoggers();
        c2c_startPhone();
    } else {
        c2c_setWebsocketLoggers(logger)
            .catch((e) => {
                c2c_setConsoleLoggers();
                c2c_ac_log('Cannot connect to logger server', e);
            })
            .finally(() => {
                c2c_startPhone();
            })
    }
}

// Start cick to call phone.
async function c2c_startPhone() {
    // Load any previously saved settings from sessionStorage
    c2c_loadSettingsFromStorage();

    c2c_ac_log(`------ Date: ${new Date().toDateString()} -------`);
    c2c_ac_log(c2c_userAgent);
    c2c_ac_log(`SDK: ${c2c_phone.version()}`);
    c2c_ac_log(`SIP: ${JsSIP.C.USER_AGENT}`);
    c2c_ac_log(`Browser: ${c2c_phone.getBrowserName()}  Internal name: ${c2c_phone.getBrowser()}|${c2c_phone.getOS()}`);

    // Log config to debug panel
    c2c_debugAddEntry('info', '[Config] SBC addresses: ' + JSON.stringify(c2c_serverConfig.addresses));
    c2c_debugAddEntry('info', '[Config] Domain: ' + c2c_serverConfig.domain);
    c2c_debugAddEntry('info', '[Config] Call user: ' + c2c_config.call);
    c2c_debugAddEntry('info', '[Config] Caller: ' + c2c_config.caller);
    c2c_debugAddEntry('info', '[Config] Call type: ' + c2c_config.type);
    c2c_debugAddEntry('info', '[Config] Protocol: ' + location.protocol);
    c2c_debugAddEntry('info', '[Config] User agent: ' + navigator.userAgent);

    c2c_phone.setUserAgent(`${c2c_userAgent} ${c2c_phone.version()} ${c2c_phone.getBrowserName()}`);

    // The device selection feature is optional
    if (c2c_config.selectDevicesEnabled) {
        c2c_devices = new SelectDevices();

        c2c_devices.setDevices(true,
            [{ name: 'microphone', kind: 'audioinput' },
            { name: 'camera', kind: 'videoinput' },
            { name: 'speaker', kind: 'audiooutput' }]);

        // click-to-call does not use local storage, but uses session storage
        // to restore selected devices after page reload.
        let selectedDevices = sessionStorage.getItem('c2c_selectedDevices');
        if (selectedDevices !== null) {
            c2c_devices.load(JSON.parse(selectedDevices));
        }

        await c2c_devices.enumerate(false);
    }

    // Optional url parameters: 'call', 'dtmf', 'delay', 'server', 'domain', 'logger', 'token' E.g. ?call=user1&delay=2000&dtmf=1234%23&server=sbc.audiocodes.com
    let call = c2c_getStrUrlParameter('call');
    if (call) {
        if (c2c_config.call === '_take_value_from_url_') {
            c2c_config.call = c2c_stringDropCharacters(call, ' -');
        } else {
            c2c_ac_log(`Error: URL parameter "call" is ignored. To enable set configuration "call: '_take_value_from_url_'"`);
        }
    }

    let domain = c2c_getStrUrlParameter('domain');
    if (domain) {
        if (c2c_serverConfig.domain === '_take_value_from_url_') {
            c2c_serverConfig.domain = domain;
        } else {
            c2c_ac_log(`Error: URL parameter "domain" is ignored. To enable set configuration "domain: '_take_value_from_url_'"`);
        }
    }

    let server = c2c_getStrUrlParameter('server');
    if (server) {
        if (c2c_serverConfig.addresses === '_take_value_from_url_') {
            c2c_serverConfig.addresses = [`wss://${server}`];
        } else {
            c2c_ac_log(`Error: URL parameter "server" is ignored. To enable set configuration "addresses: '_take_value_from_url_'"`);
        }
    }

    // Get optional secure token from URL if configured.
    let token = c2c_getStrUrlParameter('token');
    if (token) {
        if (c2c_config.urlToken) {
            c2c_token = token;
        } else {
            c2c_ac_log(`Error: URL parameter "token" is ignored. To enable set configuration "urlToken: true"`);
        }
    }

    let dtmf = c2c_getStrUrlParameter('dtmf');
    if (dtmf) {
        c2c_dtmfSequence = c2c_stringDropCharacters(dtmf, ' -');
    }
    c2c_dtmfDelay = c2c_getIntUrlParameter('delay', c2c_dtmfDelay);
    if (call || dtmf) {
        c2c_ac_log(`URL parameters: call=${call} dtmf=${dtmf} delay=${c2c_dtmfDelay}`
            + `\nAfter filtering: call=${c2c_config.call}  dtmf=${c2c_dtmfSequence}`);
    }

    // Get HTML element references.
    // Check presence of mandatory elements.
    if (!c2c_getHTMLPageReferences()) {
        return; // Missed mandatory HTML element, please fix used HTML.
    }

    // Set buttons handlers
    c2c_callButton.onclick = function () { c2c_buttonHandler('call button', c2c_callButtonHandler); }
    if (c2c_selectDevicesButton) c2c_selectDevicesButton.onclick = function () { c2c_buttonHandler('select devices button', c2c_selectDevices); }
    if (c2c_keypadButton) c2c_keypadButton.onclick = function () { c2c_buttonHandler('keypad show/hide button', c2c_keypadToggle); }
    if (c2c_screenSharingButton) c2c_screenSharingButton.onclick = function () { c2c_buttonHandler('screen share button', c2c_screenSharingToggle); }

    // Settings panel
    if (c2c_settingsButton) {
        c2c_settingsButton.onclick = function () {
            c2c_loadSettingsToModal();
            c2c_settingsModal.style.display = 'flex';
        };
    }
    if (c2c_settingsCloseBtn) {
        c2c_settingsCloseBtn.onclick = function () {
            c2c_settingsModal.style.display = 'none';
        };
    }
    if (c2c_settingsSaveBtn) {
        c2c_settingsSaveBtn.onclick = function () {
            c2c_saveSettingsFromModal();
            c2c_settingsModal.style.display = 'none';
        };
    }
    // Close modal on overlay click
    c2c_settingsModal.onclick = function (e) {
        if (e.target === c2c_settingsModal) {
            c2c_settingsModal.style.display = 'none';
        }
    };

    // Debug panel
    if (c2c_debugBtn) {
        c2c_debugBtn.onclick = function () {
            c2c_toggleDebugPanel();
        };
    }
    if (c2c_debugCloseBtn) {
        c2c_debugCloseBtn.onclick = function () {
            c2c_closeDebugPanel();
        };
    }
    if (c2c_debugClearBtn) {
        c2c_debugClearBtn.onclick = function () {
            c2c_clearDebugLog();
        };
    }
    if (c2c_debugCopyBtn) {
        c2c_debugCopyBtn.onclick = function () {
            c2c_copyDebugLog();
        };
    }
    if (c2c_debugDiagBtn) {
        c2c_debugDiagBtn.onclick = function () {
            c2c_diagnoseSBC();
        };
    }

    if (c2c_cameraButton) c2c_cameraButton.onclick = function () { c2c_buttonHandler('webcam on/off button', c2c_cameraToggle); }
    if (c2c_selfVideoChk) c2c_selfVideoChk.onclick = function () { c2c_buttonHandler('show local video', c2c_selfVideoToggle); }

    // Device test button
    if (c2c_deviceTestBtn) {
        c2c_deviceTestBtn.onclick = function () {
            c2c_buttonHandler('device test button', function () {
                c2c_toggleDeviceTest();
            });
        };
    }
    if (c2c_deviceTestCloseBtn) {
        c2c_deviceTestCloseBtn.onclick = function () {
            c2c_closeDeviceTest();
        };
    }
    if (c2c_cameraPreviewBtn) {
        c2c_cameraPreviewBtn.onclick = function () {
            c2c_toggleCameraPreview();
        };
    }
    if (c2c_micTestBtn) {
        c2c_micTestBtn.onclick = function () {
            c2c_toggleMicTest();
        };
    }
    if (c2c_speakerTestBtn) {
        c2c_speakerTestBtn.onclick = function () {
            c2c_playSpeakerTest();
        };
    }
    // Check WebRTC support. If loaded from unsecure context (HTTP site) the WebRTC API is hidden. 
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        c2c_info('No WebRTC');
        c2c_gui_phoneDisabled('WebRTC API is not supported in this browser !');
        return;
    }

    // Check presence of microphone, speaker, web camera.
    try {
        c2c_hasCamera = await c2c_phone.checkAvailableDevices();
        c2c_ac_log(`Camera is ${c2c_hasCamera ? 'present' : 'missing'}`);
    } catch (e) {
        if (c2c_config.allowCallWithoutMicrophone) {
            c2c_ac_log('Microphone is missed. Used "allowCallWithoutMicrophone" mode');
            c2c_hasMicrophone = false;
        } else {
            c2c_info('No microphone or speaker !'); // Please connect headset and reload page.
            c2c_gui_phoneDisabled('No microphone or speaker !');
            return;
        }
    }

    if (location.protocol !== 'https:' && location.protocol !== 'file:') {
        c2c_ac_log('Warning: for the URL used "' + location.protocol + '" protocol');
    }

    // Check if used TURN
    for (let server of c2c_serverConfig.iceServers) {
        if (typeof server === 'string')
            continue;
        let url = Array.isArray(server.urls) ? server.urls[0] : server.urls;
        if (url.startsWith('turn:')) {
            c2c_usedTurnServer = true;
            break;
        }
    }

    // Prepare restore call data c2c_restoreCall
    let data = sessionStorage.getItem('c2c_restoreCall');
    if (data !== null) {
        sessionStorage.removeItem('c2c_restoreCall');

        c2c_restoreCall = JSON.parse(data);
        let delay = Math.ceil(Math.abs(c2c_restoreCall.time - new Date().getTime()) / 1000);
        if (delay > c2c_config.restoreCallMaxDelay) { // 1.19 bug fix. Igor
            c2c_ac_log('No restore call, delay is too long (' + delay + ' seconds)');
            c2c_restoreCall = null;
        }
    }

    // GUI initialization
    window.addEventListener('beforeunload', c2c_onBeforeUnload);

    // Prepare audio player
    c2c_audioPlayer.init({ logger: c2c_ac_log });

    // Download sounds (if used). Generate tones.
    await c2c_audioPlayer.downloadSounds('../sounds/', c2c_soundConfig.downloadSounds)

    await c2c_audioPlayer.generateTonesSuite(c2c_soundConfig.generateTones);

    if (c2c_config.dtmfKeypadEnabled) {
        let { A, B, C, D, ...basicDtmfTones } = c2c_audioPlayer.dtmfTones; // exclude A,B,C,D tones
        await c2c_audioPlayer.generateTonesSuite(basicDtmfTones);
    }

    c2c_ac_log('audioPlayer2: sounds are ready');

    if (c2c_devices) {
        let spkrId = c2c_devices.getSelected('speaker').deviceId;
        c2c_audioPlayer.setSpeakerId(spkrId);
    }

    c2c_gui_phoneBeforeCall();

    if (c2c_restoreCall === null) {
        /* Call auto start after page downloaded */
        let callAutoStart = !!c2c_config.callAutoStart ? c2c_config.callAutoStart.toLowerCase() : 'no';
        if ((callAutoStart === 'yes force') || (callAutoStart === 'yes' && !c2c_audioPlayer.isDisabled())) {
            if (c2c_audioPlayer.isDisabled()) {
                c2c_ac_log('Start call automatically. Warning: audio player is disabled. So you cannot hear beeps!');
            } else {
                c2c_ac_log('Start call automatically');
            }
            c2c_call();
        }
    }

    // Restore call after page reload
    if (c2c_restoreCall !== null) {
        c2c_ac_log('Trying to restore call', c2c_restoreCall);
        c2c_call();
    }
}
// Get mandatory HTML elements references
function c2c_getHTMLPageReferences() {
    c2c_widgetDiv = document.getElementById('c2c_widget_div');
    if (!c2c_widgetDiv) {
        c2c_ac_log('Fatal error: HTML missed div id="c2c_widget"');
        return false;
    }

    c2c_callButton = document.getElementById('c2c_call_btn');
    if (!c2c_callButton) {
        c2c_ac_log('Fatal error: HTML missed button id="c2c_call_btn"');
        return false;
    }

    // Save original call button title.
    c2c_callButtonTitle = c2c_callButton.title;

    c2c_remoteVideo = document.getElementById('c2c_remote_video');
    if (!c2c_remoteVideo) {
        c2c_ac_log('Fatal error: HTML missed video element id="c2c_remote_video"');
        return false;
    }
    c2c_localVideo = document.getElementById('c2c_local_video');
    if (!c2c_localVideo) {
        c2c_ac_log('Fatal error: HTML missed video element id="c2c_local_video"');
        return false;
    }

    c2c_status_line = document.getElementById('c2c_status_line');
    if (!c2c_status_line) {
        c2c_ac_log('Fatal error: HTML missed div id="c2c_status_line"');
        return false;
    }

    // Get HTML element if select devices feature used.
    if (c2c_devices) {
        c2c_selectDevicesButton = document.getElementById('c2c_select_devices_btn');
        c2c_selectDevicesDiv = document.getElementById('c2c_select_devices_div');
    }

    if (c2c_config.dtmfKeypadEnabled) {
        c2c_keypadButton = document.getElementById('c2c_keypad_btn');
        c2c_keypadDiv = document.getElementById('c2c_keypad_div');
    }

    if (c2c_config.screenSharingEnabled) {
        if (c2c_phone.isScreenSharingSupported()) {
            c2c_screenSharingButton = document.getElementById('c2c_screen_sharing_btn');
            if (!c2c_screenSharingButton) {
                c2c_ac_log('Fatal error: Mode screenSharingEnabled and HTML missed button id="c2c_screen_sharing_btn"');
                return false;
            }
            c2c_screenSharingButton.style.display = 'none';
        } else {
            c2c_ac_log('Warning: screen sharing is not supported in the browser');
        }
    }

    // Get HTML elements for call type 'user_control'
    c2c_videoSpan = document.getElementById('c2c_video_chk_span');
    c2c_videoCheckbox = document.getElementById('c2c_video_chk');
    c2c_cameraButton = document.getElementById('c2c_camera_btn');
    c2c_cameraLineSvg = document.getElementById('c2c_camera_line_svg');

    if (c2c_config.type === 'user_control') {
        if (!c2c_videoSpan) {
            c2c_ac_log('Fatal error: Call type is "user_control" and HTML missed span id="c2c_video_chk_span"');
            return false;
        }
        if (!c2c_videoCheckbox) {
            c2c_ac_log('Fatal error: Call type is "user_control" and HTML missed checkbox id="c2c_video_chk"');
            return false;
        }

        if (!c2c_cameraButton) {
            c2c_ac_log('Fatal error: Call type is "user_control" and HTML missed button id="c2c_camera_btn"');
            return false;
        }
        if (!c2c_cameraLineSvg) {
            c2c_ac_log('Fatal error: Call type is "user_control" and HTML missed svg id="c2c_camera_line_svg"');
            return false;
        }
    }

    // Set click events for keypad buttons
    if (c2c_config.dtmfKeypadEnabled) {
        let table = document.getElementById('c2c_keypad_table');
        for (let row of table.getElementsByTagName('tr')) {
            for (let cell of row.getElementsByTagName('td')) {
                cell.onclick = () => c2c_sendDtmf(cell.innerText);
            }
        }
    }

    if (c2c_config.selfVideoEnabled) {
        c2c_selfVideoSpan = document.getElementById('c2c_self_video_chk_span')
        c2c_selfVideoChk = document.getElementById('c2c_self_video_chk');
        if (!c2c_selfVideoSpan) {
            c2c_ac_log('Fatal error: missed span id="c2c_self_video_chk_span"');
            return false;
        }
        if (!c2c_selfVideoChk) {
            c2c_ac_log('Fatal error: missed span id="c2c_self_video_chk"');
            return false;
        }

        c2c_isSelfVideo = c2c_config.selfVideoCheckboxDefault;
        c2c_selfVideoChk.checked = c2c_isSelfVideo;
    }

    // Get settings panel elements
    c2c_settingsButton = document.getElementById('c2c_settings_btn');
    c2c_settingsModal = document.getElementById('c2c_settings_modal');
    c2c_settingsCloseBtn = document.getElementById('c2c_settings_close_btn');
    c2c_settingsSaveBtn = document.getElementById('c2c_settings_save_btn');

    // Get auth elements
    c2c_loginBtn = document.getElementById('c2c_login_btn');
    c2c_userBtn = document.getElementById('c2c_user_btn');
    c2c_userMenuModal = document.getElementById('c2c_user_menu_modal');
    c2c_userMenuCloseBtn = document.getElementById('c2c_user_menu_close_btn');
    c2c_logoutBtn = document.getElementById('c2c_logout_btn');

    // Get debug panel elements
    c2c_debugBtn = document.getElementById('c2c_debug_btn');
    c2c_debugPanel = document.getElementById('c2c_debug_panel');
    c2c_debugLog = document.getElementById('c2c_debug_log');
    c2c_debugCloseBtn = document.getElementById('c2c_debug_close_btn');
    c2c_debugClearBtn = document.getElementById('c2c_debug_clear_btn');
    c2c_debugCopyBtn = document.getElementById('c2c_debug_copy_btn');
    c2c_debugCopyBtn = document.getElementById('c2c_debug_copy_btn');
    c2c_debugStatusEl = document.getElementById('c2c_debug_status');
    c2c_debugDiagBtn = document.getElementById('c2c_debug_diag_btn');

    // Get device test elements
    c2c_deviceTestBtn = document.getElementById('c2c_device_test_btn');
    c2c_deviceTestDiv = document.getElementById('c2c_device_test_div');
    c2c_deviceTestCloseBtn = document.getElementById('c2c_device_test_close_btn');
    c2c_cameraPreview = document.getElementById('c2c_camera_preview');
    c2c_cameraPreviewPlaceholder = document.getElementById('c2c_camera_preview_placeholder');
    c2c_cameraPreviewBtn = document.getElementById('c2c_camera_preview_btn');
    c2c_micTestBtn = document.getElementById('c2c_mic_test_btn');
    c2c_micLevelFill = document.getElementById('c2c_mic_level_fill');
    c2c_micLevelText = document.getElementById('c2c_mic_level_text');
    c2c_speakerTestBtn = document.getElementById('c2c_speaker_test_btn');
    c2c_speakerTestResult = document.getElementById('c2c_speaker_test_result');

    return true;
}

// Use any button interaction to enable sound
function c2c_buttonHandler(name, handler) {
    c2c_ac_log(`phone>> "${name}" onclick event`);
    if (!c2c_audioPlayer.isDisabled()) {
        handler();
        return;
    }
    c2c_ac_log('Let enable sound...');
    c2c_audioPlayer.enable()
        .then(() => {
            c2c_ac_log('Sound is enabled')
        })
        .catch((e) => {
            c2c_ac_log('Cannot enable sound', e);
        })
        .finally(() => {
            handler();
        });
}

// Secure URL parameter extraction
// Only allow alphanumeric, @, ., :, /, _, - characters to prevent injection
const c2c_urlParamSafeRegex = /^[a-zA-Z0-9@.:\/\_\-]+$/;

function c2c_getStrUrlParameter(name, defValue = null) {
    let s = window.location.search.split('&' + name + '=')[1];
    if (!s) s = window.location.search.split('?' + name + '=')[1];
    if (s === undefined) return defValue;
    try {
        let value = decodeURIComponent(s.split('&')[0]);
        // Only allow safe characters
        if (value !== '' && !c2c_urlParamSafeRegex.test(value)) {
            console.warn('[Security] Rejected URL parameter: ' + name + ' contains unsafe characters');
            return defValue;
        }
        return value;
    } catch (e) {
        console.warn('[Security] Invalid URL parameter encoding: ' + name);
        return defValue;
    }
}

function c2c_getIntUrlParameter(name, defValue = null) {
    let s = window.location.search.split('&' + name + '=')[1];
    if (!s) s = window.location.search.split('?' + name + '=')[1];
    if (s === undefined) return defValue;
    let val = parseInt(decodeURIComponent(s.split('&')[0]));
    return isNaN(val) ? defValue : val;
}

// Filter for URL parameters values (e.g. to remove '-' characters)
function c2c_stringDropCharacters(text, removeChars) {
    let result = '';
    for (let c of text) {
        if (!removeChars.includes(c))
            result += c;
    }
    return result;
}

function c2c_delay(ms) { return new Promise((r) => { setTimeout(() => r(), ms); }); }

function c2c_timestamp() {
    let date = new Date();
    let h = date.getHours();
    let m = date.getMinutes();
    let s = date.getSeconds();
    let ms = date.getMilliseconds();
    return ((h < 10) ? '0' + h : h) + ':' + ((m < 10) ? '0' + m : m) + ':' + ((s < 10) ? '0' + s : s) + '.' + ('00' + ms).slice(-3) + ' ';
}

// Search server address in array of addresses
function c2c_searchServerAddress(addresses, searchAddress) {
    searchAddress = searchAddress.toLowerCase();
    for (let ix = 0; ix < addresses.length; ix++) {
        let data = addresses[ix]; // can be address or [address, priority]
        let address = data instanceof Array ? data[0] : data;
        if (address.toLowerCase() === searchAddress)
            return ix;
    }
    return -1;
}

function c2c_setConsoleLoggers() {
    let useColor = ['chrome', 'firefox', 'safari'].includes(c2c_phone.getBrowser());
    // Safe JSON stringify that handles circular references
    function safeStringify(obj) {
        if (typeof obj !== 'object' || obj === null) return String(obj);
        try {
            let seen = new WeakSet();
            return JSON.stringify(obj, function(key, val) {
                if (typeof val === 'object' && val !== null) {
                    if (seen.has(val)) return '[Circular]';
                    seen.add(val);
                }
                return val;
            });
        } catch(e) {
            return '[Object]';
        }
    }
    const log1 = function () {
        let args = [].slice.call(arguments);
        let firstArg = [c2c_timestamp() + '' + (useColor ? '%c' : '') + args[0]];
        if (useColor) firstArg = firstArg.concat(['color: BlueViolet;']);
        console.log.apply(console, firstArg.concat(args.slice(1)));
        // Also send to debug panel
        let extra = args.length > 1 ? ' ' + args.slice(1).map(a => safeStringify(a)).join(' ') : '';
        c2c_debugAddEntry('info', c2c_timestamp() + args[0] + extra);
    };
    let log2 = function () {
        let args = [].slice.call(arguments);
        let firstArg = [c2c_timestamp() + args[0]];
        console.log.apply(console, firstArg.concat(args.slice(1)));
        let extra = args.length > 1 ? ' ' + args.slice(1).map(a => safeStringify(a)).join(' ') : '';
        c2c_debugAddEntry('debug', c2c_timestamp() + args[0] + extra);
    };
    c2c_ac_log = log1;              // phone log
    c2c_phone.setAcLogger(log1);    // api log
    c2c_phone.setJsSipLogger(log2); // jssip log
}

function c2c_setWebsocketLoggers(url) {
    return new Promise((resolve, reject) => {
        let ws = new WebSocket('wss://' + url, 'wslog');
        ws.onopen = () => { resolve(ws); }
        ws.onerror = (e) => { reject(e); }
    })
        .then(ws => {
            const log = function () {
                let args = [].slice.call(arguments);
                let msg = [c2c_timestamp() + args[0]].concat(args.slice(1)).join();
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(msg + '\n');
                } else {
                    console.log(msg);
                }
            };
            c2c_ac_log(`Sending log to "${url}"`);
            c2c_ac_log = log;
            c2c_phone.setAcLogger(log);
            c2c_phone.setJsSipLogger(log);
        })
}

/* =============================================
   Debug Panel
   ============================================= */

// Add entry to debug log
function c2c_debugAddEntry(level, text) {
    // Store entry (always, even without DOM - popup reads from this array)
    c2c_debugEntries.push({ level, text, time: Date.now() });
    // Keep max 500 entries
    if (c2c_debugEntries.length > 500) {
        c2c_debugEntries.shift();
    }
    // If panel is visible, append to DOM
    if (c2c_debugVisible && c2c_debugLog) {
        let div = document.createElement('div');
        div.className = 'log-entry';
        div.innerHTML = '<span class="log-' + level + '">' + c2c_escapeHtml(text) + '</span>';
        c2c_debugLog.appendChild(div);
        c2c_debugLog.scrollTop = c2c_debugLog.scrollHeight;
    }
}

// Escape HTML for safety
function c2c_escapeHtml(str) {
    let div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
}

let c2c_debugWindow = null;  // Reference to the popup debug window

// Toggle debug panel
function c2c_toggleDebugPanel() {
    if (c2c_debugVisible) {
        c2c_closeDebugPanel();
    } else {
        c2c_openDebugPanel();
    }
}

function c2c_openDebugPanel() {
    c2c_debugVisible = true;
    c2c_debugPanel.style.display = 'block';
    c2c_debugBtn.style.borderColor = 'var(--primary)';
    c2c_debugBtn.style.color = 'var(--primary-light)';
    
    // Render all stored entries
    c2c_debugLog.innerHTML = '';
    for (let entry of c2c_debugEntries) {
        let div = document.createElement('div');
        div.className = 'log-entry';
        div.innerHTML = '<span class="log-' + entry.level + '">' + c2c_escapeHtml(entry.text) + '</span>';
        c2c_debugLog.appendChild(div);
    }
    c2c_debugLog.scrollTop = c2c_debugLog.scrollHeight;
    
    c2c_updateDebugStatus();
    c2c_ac_log('Debug panel opened');
}

function c2c_closeDebugPanel() {
    c2c_debugVisible = false;
    c2c_debugPanel.style.display = 'none';
    c2c_debugBtn.style.borderColor = 'transparent';
    c2c_debugBtn.style.color = '';
}

function c2c_clearDebugLog() {
    c2c_debugEntries = [];
    if (c2c_debugLog) c2c_debugLog.innerHTML = '';
    c2c_updateDebugStatus();
}

function c2c_copyDebugLog() {
    let text = c2c_debugEntries.map(e => e.text).join('\n');
    navigator.clipboard.writeText(text).then(() => {
        c2c_ac_log('Debug log copied to clipboard');
    }).catch(() => {
        // Fallback
        let ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
    });
}

function c2c_updateDebugStatus(statusText, statusClass) {
    if (!c2c_debugStatusEl) return;
    if (statusText) {
        // statusClass is controlled internally (safe), statusText comes from controlled calls
        c2c_debugStatusEl.innerHTML = 'Status: <span class="' + c2c_escapeHtml(statusClass) + '">' + c2c_escapeHtml(statusText) + '</span>';
    } else {
        let lastEntries = c2c_debugEntries.slice(-3);
        let hasError = lastEntries.some(e => e.level === 'error');
        let hasWarn = lastEntries.some(e => e.level === 'warn');
        if (hasError) {
            c2c_debugStatusEl.innerHTML = 'Status: <span class="status-error">Has errors</span>';
        } else if (hasWarn) {
            c2c_debugStatusEl.innerHTML = 'Status: <span class="status-warn">Has warnings</span>';
        } else {
            let wsState = c2c_isWsConnected ? 'Connected' : (c2c_phone.isInitialized() ? 'Connecting...' : 'Idle');
            c2c_debugStatusEl.textContent = 'Status: ' + wsState + ' | Logs: ' + c2c_debugEntries.length;
        }
    }
}

/* =============================================
   SBC Connection Diagnostic
   ============================================= */

// Run a direct WebSocket test to diagnose connectivity issues
async function c2c_diagnoseSBC() {
    c2c_debugAddEntry('info', '=== SBC Diagnostic Started ===');
    c2c_debugAddEntry('info', '[Diag] Testing WebSocket connection...');
    c2c_updateDebugStatus('Diagnosing...', 'status-warn');

    let addresses = c2c_serverConfig.addresses;
    let domain = c2c_serverConfig.domain;

    if (!addresses || (Array.isArray(addresses) && addresses.length === 0) || addresses === '_take_value_from_url_') {
        c2c_debugAddEntry('error', '[Diag] No SBC WebSocket address configured! Go to Settings and set an address.');
        c2c_updateDebugStatus('No SBC address', 'status-error');
        return;
    }

    // Get the first address
    let addr = Array.isArray(addresses) ? addresses[0] : addresses;
    let wsUrl = (Array.isArray(addr) ? addr[0] : addr).toString();

    c2c_debugAddEntry('info', '[Diag] Target: ' + wsUrl);
    c2c_debugAddEntry('info', '[Diag] Domain: ' + domain);
    c2c_debugAddEntry('info', '[Diag] Protocol: ' + location.protocol);
    c2c_debugAddEntry('info', '[Diag] Browser: ' + navigator.userAgent);

    // Check if using HTTPS - WebSocket requires secure context
    if (location.protocol !== 'https:' && location.protocol !== 'file:') {
        c2c_debugAddEntry('warn', '[Diag] Page loaded over HTTP. WebSocket may be blocked by Mixed Content policy.');
        c2c_debugAddEntry('warn', '[Diag] Try: load page via HTTPS or use the dev server on localhost.');
    }

    // Validate URL format
    if (!wsUrl.startsWith('wss://') && !wsUrl.startsWith('ws://')) {
        c2c_debugAddEntry('error', '[Diag] Invalid WebSocket URL: "' + wsUrl + '". Must start with wss:// or ws://');
        c2c_updateDebugStatus('Invalid URL', 'status-error');
        return;
    }

    // Try direct WebSocket connection
    try {
        c2c_debugAddEntry('info', '[Diag] Attempting direct WebSocket connection to ' + wsUrl + '...');
        let startTime = Date.now();
        
        // First do a quick HTTP check to see if server is reachable
        let httpUrl = wsUrl.replace(/^ws/, 'http');
        c2c_debugAddEntry('info', '[Diag] Checking HTTP reachability: ' + httpUrl + ' ...');
        try {
            let httpResp = await fetch(httpUrl, { method: 'HEAD', mode: 'no-cors' });
            c2c_debugAddEntry('info', '[Diag] ✅ Server reachable via HTTP (status: ' + httpResp.status + ')');
            c2c_debugAddEntry('info', '[Diag]    Server is online but needs correct WebSocket path.');
            c2c_debugAddEntry('info', '[Diag]    Try paths: /webrtc, /ws, /wssip');
        } catch (httpErr) {
            c2c_debugAddEntry('info', '[Diag] HTTP check failed (expected if server is WS-only)');
        }
        
        let ws = new WebSocket(wsUrl, 'sip');

        // Set a timeout (10 seconds)
        let timeoutId = setTimeout(() => {
            c2c_debugAddEntry('error', '[Diag] ⏱ Connection TIMEOUT after 10s. Server unreachable or firewall blocking.');
            c2c_debugAddEntry('info', '[Diag] ─── Possible Causes ───');
            c2c_debugAddEntry('info', '  🔴 Server is not reachable from this network');
            c2c_debugAddEntry('info', '  • DNS resolution failed for ' + wsUrl);
            c2c_debugAddEntry('info', '  • Firewall is blocking outbound connections on port 443');
            c2c_debugAddEntry('info', '  • Server may be down or not running WebSocket service');
            c2c_debugAddEntry('info', '[Diag] ─── Try these instead ───');
            let base = wsUrl.replace(/^wss?:\/\//, '').split('/')[0].split(':')[0];
            c2c_diagTryAlternatives(base, wsUrl);
            c2c_updateDebugStatus('Connection timeout', 'status-error');
            try { ws.close(); } catch(e) {}
        }, 10000);

        ws.onopen = function () {
            clearTimeout(timeoutId);
            let elapsed = Date.now() - startTime;
            c2c_debugAddEntry('success', '[Diag] WebSocket connected successfully! (' + elapsed + 'ms)');
            c2c_debugAddEntry('info', '[Diag] The SBC server is reachable and WebSocket is working.');
            c2c_debugAddEntry('info', '[Diag] If calls still fail, check:');
            c2c_debugAddEntry('info', '  1. Domain setting matches the SBC certificate');
            c2c_debugAddEntry('info', '  2. Call user/number is valid');
            c2c_debugAddEntry('info', '  3. Authentication credentials');
            c2c_updateDebugStatus('Connected! (' + elapsed + 'ms)', 'status-ok');
            c2c_isWsConnected = true;
            setTimeout(() => { try { ws.close(); } catch(e) {} }, 1000);
        };

        ws.onerror = function (e) {
            clearTimeout(timeoutId);
            let elapsed = Date.now() - startTime;
            c2c_debugAddEntry('error', '[Diag] ❌ WebSocket error after ' + elapsed + 'ms');
            c2c_debugAddEntry('info', '[Diag] ─── Possible Causes ───');
            
            // Extract base hostname for suggestions
            let baseUrl = wsUrl.replace(/^wss?:\/\//, '').split('/')[0].split(':')[0];
            
            if (elapsed < 500) {
                c2c_debugAddEntry('info', '  🔴 Connection REFUSED very quickly (' + elapsed + 'ms) — server unreachable');
                c2c_debugAddEntry('info', '  • Server may be down or DNS not resolving: ' + baseUrl);
                c2c_debugAddEntry('info', '  • Firewall may be blocking outbound WebSocket connections');
                c2c_debugAddEntry('info', '  • Try pinging: ' + baseUrl);
            } else if (elapsed < 1500) {
                c2c_debugAddEntry('info', '  🟠 Server reached but returned non-WebSocket response (' + elapsed + 'ms)');
                c2c_debugAddEntry('info', '  • A Web server is running at ' + baseUrl + ' but it is not a WebSocket endpoint');
                c2c_debugAddEntry('info', '  • You likely need to add a path, e.g.: /webrtc, /ws, /wssip');
                c2c_debugAddEntry('info', '  • Or use a different port like 7443 or 8443');
            } else {
                c2c_debugAddEntry('info', '  🟡 SSL/TLS handshake failure (' + elapsed + 'ms) — certificate issue or wrong port');
                c2c_debugAddEntry('info', '  • Server may use a self-signed certificate');
                c2c_debugAddEntry('info', '  • Try different ports: wss://' + baseUrl + ':7443 or wss://' + baseUrl + ':8443');
            }
            
            c2c_debugAddEntry('info', '[Diag] ─── Auto-scanning common ports & paths ───');
            c2c_diagTryAlternatives(baseUrl, wsUrl);
        };

        ws.onclose = function (e) {
            clearTimeout(timeoutId);
            let elapsed = Date.now() - startTime;
            c2c_debugAddEntry('info', '[Diag] WebSocket closed (code: ' + e.code + ', reason: "' + e.reason + '") after ' + elapsed + 'ms');
            if (e.code === 1006) {
                c2c_debugAddEntry('warn', '[Diag] Code 1006 = Abnormal Closure. SSL handshake failed or connection refused.');
                c2c_debugAddEntry('info', '[Diag] 💡 Fix: Configure SBC with correct WebSocket port/path in Settings.');
            }
        };
    } catch (e) {
        c2c_debugAddEntry('error', '[Diag] Exception: ' + e.message);
        c2c_updateDebugStatus('Error: ' + e.message, 'status-error');
    }
}

// Try alternative ports/paths for WebSocket diagnosis
async function c2c_diagTryAlternatives(baseHost, originalUrl) {
    let alternatives = [];
    let baseNoPort = baseHost.includes(':') ? baseHost.split(':')[0] : baseHost;
    let baseWithPort = baseHost.includes(':') ? baseHost : null;
    let hasPath = originalUrl.includes('/webrtc') || originalUrl.includes('/ws');
    
    // Common WebSocket paths for AudioCodes SBC
    let paths = ['', '/webrtc', '/ws', '/wssip'];
    
    // Generate alternatives — try path-based first (most likely for AudioCodes)
    for (let p of paths) {
        if (p === '' && hasPath) continue; // skip plain if already tried
        if (!alternatives.includes('wss://' + baseNoPort + p)) {
            alternatives.push('wss://' + baseNoPort + p);
        }
    }
    
    // Add port-based alternatives
    let ports = ['7443', '8443', '8080'];
    for (let port of ports) {
        for (let p of paths) {
            if (p === '' && hasPath) continue;
            let alt = 'wss://' + baseNoPort + ':' + port + p;
            if (!alternatives.includes(alt)) {
                alternatives.push(alt);
            }
        }
    }
    
    // Limit to 6 attempts
    let toTry = alternatives.slice(0, 6);
    let found = false;
    
    for (let alt of toTry) {
        if (found) break;
        c2c_debugAddEntry('info', '[Diag] Trying: ' + alt + ' ...');
        try {
            let result = await c2c_diagTestOne(alt, 3000);
            if (result.success) {
                c2c_debugAddEntry('success', '[Diag] ✅ SUCCESS! ' + alt + ' connected (' + result.ms + 'ms)');
                c2c_debugAddEntry('info', '[Diag] 💡 Use this address in Settings > SBC WebSocket Address');
                c2c_updateDebugStatus('Found: ' + alt, 'status-ok');
                found = true;
            } else {
                c2c_debugAddEntry('info', '[Diag]    ' + alt + ' → ' + result.reason);
            }
        } catch (e) {
            c2c_debugAddEntry('info', '[Diag]    ' + alt + ' → error');
        }
    }
    
    if (!found) {
        c2c_debugAddEntry('info', '[Diag] ─────────────────────────────────');
        c2c_debugAddEntry('info', '[Diag] ❌ None of the common alternatives worked.');
        c2c_debugAddEntry('info', '[Diag] 💡 Ask your SBC administrator for the correct WebSocket URL.');
        c2c_debugAddEntry('info', '[Diag] 💡 Common AudioCodes SBC WebSocket format:');
        c2c_debugAddEntry('info', '    wss://<sbc-ip>:<port>');
        c2c_debugAddEntry('info', '    wss://<sbc-domain>/webrtc');
        c2c_debugAddEntry('info', '    wss://<sbc-domain>:7443');
    }
}

// Test a single WebSocket URL, returns after 3s timeout or on open/error
function c2c_diagTestOne(url, timeoutMs) {
    return new Promise((resolve) => {
        let start = Date.now();
        let ws;
        try {
            ws = new WebSocket(url, 'sip');
        } catch (e) {
            resolve({ success: false, reason: 'Invalid URL', ms: Date.now() - start });
            return;
        }
        
        let timer = setTimeout(() => {
            try { ws.close(); } catch(e) {}
            resolve({ success: false, reason: 'Timeout', ms: Date.now() - start });
        }, timeoutMs);
        
        ws.onopen = function () {
            clearTimeout(timer);
            let ms = Date.now() - start;
            try { ws.close(); } catch(e) {}
            resolve({ success: true, ms: ms });
        };
        
        ws.onerror = function () {
            clearTimeout(timer);
            let ms = Date.now() - start;
            try { ws.close(); } catch(e) {}
            resolve({ success: false, reason: 'Error at ' + ms + 'ms', ms: ms });
        };
    });
}

// Connect to SBC server, don't send REGISTER
function c2c_initStack(account) {
    c2c_debugAddEntry('info', '[SBC] Connecting to: ' + JSON.stringify(c2c_serverConfig.addresses));
    c2c_debugAddEntry('info', '[SBC] Domain: ' + c2c_serverConfig.domain);
    c2c_debugAddEntry('info', '[SBC] ICE servers: ' + JSON.stringify(c2c_serverConfig.iceServers));
    c2c_updateDebugStatus('Connecting...', 'status-warn');
    
    // restore previosly connected SBC after page reloading.
    if (c2c_restoreCall !== null) {
        let ix = c2c_searchServerAddress(c2c_serverConfig.addresses, c2c_restoreCall.address);
        if (ix !== -1) {
            c2c_ac_log('Page reloading, raise priority of previously connected server: "' + c2c_restoreCall.address + '"');
            c2c_serverConfig.addresses[ix] = [c2c_restoreCall.address, 1000];
        } else {
            c2c_ac_log('Cannot find previously connected server: ' + c2c_restoreCall.address + ' in configuration');
        }
    }
    c2c_phone.setServerConfig(c2c_serverConfig.addresses, c2c_serverConfig.domain, c2c_serverConfig.iceServers);
    c2c_phone.setAccount(account.user, account.displayName, account.password);
    c2c_phone.setWebSocketKeepAlive(c2c_config.pingInterval, c2c_config.pongTimeout, c2c_config.timerThrottlingBestEffort, c2c_config.pongReport, c2c_config.pongDist);

    // Set c2c_phone API listeners
    c2c_phone.setListeners({
        loginStateChanged: function (isLogin, cause) {
            switch (cause) {
                case 'connected':
                    c2c_ac_log('phone>>> loginStateChanged: connected');
                    c2c_debugAddEntry('success', '[SBC] WebSocket connected to ' + c2c_phone.getServerAddress());
                    c2c_isWsConnected = true;
                    c2c_updateDebugStatus('Connected to SBC', 'status-ok');
                    if (c2c_activeCall !== null) {
                        c2c_ac_log('phone: active call exists (SBC might have switched over to secondary)');
                        c2c_debugAddEntry('warn', '[SBC] Active call exists during reconnect');
                        break;
                    }
                    if (c2c_restoreCall !== null) {
                        if (c2c_selfVideoChk) {
                            c2c_isSelfVideo = c2c_restoreCall.selfVideo;
                            c2c_selfVideoChk.checked = c2c_isSelfVideo;
                        }
                        c2c_ac_log('send INVITE with Replaces to restore call');
                        c2c_makeCall(c2c_restoreCall.callTo,
                            c2c_restoreCall.video === 'sendrecv' || c2c_restoreCall.video === 'sendonly' ? c2c_phone.VIDEO : c2c_phone.AUDIO
                            , ['Replaces: ' + c2c_restoreCall.replaces]);
                    } else if (c2c_isStartCall) {
                        c2c_startCall();
                    }
                    break;

                case 'disconnected':
                    c2c_ac_log('phone>>> loginStateChanged: disconnected');
                    c2c_isWsConnected = false;
                    c2c_debugAddEntry('warn', '[SBC] WebSocket disconnected');
                    c2c_updateDebugStatus('Disconnected', 'status-error');
                    if (c2c_phone.isInitialized()) {
                        if (c2c_sbcDisconnectCounter++ >= c2c_sbcDisconnectCounterMax && c2c_activeCall === null) {
                            c2c_ac_log('phone: too many disconnections.');
                            c2c_debugAddEntry('error', '[SBC] Too many disconnection attempts (' + c2c_sbcDisconnectCounterMax + ' max)');
                            c2c_debugAddEntry('error', '[SBC] Check server address: ' + JSON.stringify(c2c_serverConfig.addresses));
                            c2c_debugAddEntry('error', '[SBC] Check domain: ' + c2c_serverConfig.domain);
                            c2c_debugAddEntry('info', '[SBC] Click "Test SBC" button in Debug panel to diagnose connectivity.');
                            c2c_phone.deinit();
                            c2c_info('⚠️ Cannot connect to SBC. Open Debug Log (top-right) > "Test SBC" for diagnosis.');
                            c2c_gui_phoneBeforeCall();
                        } else {
                            c2c_debugAddEntry('warn', '[SBC] Reconnection attempt ' + c2c_sbcDisconnectCounter + '/' + c2c_sbcDisconnectCounterMax);
                        }
                    }
                    break;

                case 'login failed':
                    c2c_ac_log('phone>>> loginStateChanged: login failed');
                    c2c_debugAddEntry('error', '[SBC] Login failed - check credentials or server configuration');
                    c2c_updateDebugStatus('Login failed', 'status-error');
                    break;

                case 'login':
                    c2c_ac_log('phone>>> loginStateChanged: login');
                    break;

                case 'logout':
                    c2c_ac_log('phone>>> loginStateChanged: logout');
                    break;
            }
        },

        outgoingCallProgress: function (call, response) {
            c2c_ac_log('phone>>> outgoing call progress');
            c2c_info('Ringing', true);
            c2c_audioPlayer.play(c2c_soundConfig.play.outgoingCallProgress);
        },

        callTerminated: function (call, message, cause, redirectTo) {
            c2c_ac_log(`phone>>> call terminated callback, cause=${cause}`);
            c2c_activeCall = null;
            if (cause === 'Redirected') {
                c2c_ac_log(`Redirect call to ${redirectTo}`);
                c2c_makeCall(redirectTo, c2c_videoOption());
                return;
            }

            c2c_audioPlayer.stop();
            let terminatedInfo = cause;
            c2c_info(terminatedInfo, true);
            if (call.isOutgoing() && !call.wasAccepted()) {
                // Busy tone.
                c2c_audioPlayer.play(c2c_soundConfig.play.busy);
            } else {
                // Disconnect tone.
                c2c_audioPlayer.play(c2c_soundConfig.play.disconnect);
            }

            let interval = c2c_config.keepConnectionAfterCall;
            if (interval === 0 || interval === undefined) {
                c2c_phone.deinit();
            } else {
                c2c_sbcDisconnectTimer = setTimeout(() => {
                    c2c_ac_log('The time interval between the end of the call and SBC disconnection is over');
                    c2c_phone.deinit();
                }, interval * 1000);
            }

            c2c_gui_phoneBeforeCall();

            // Hide black rectangles after video call
            c2c_setLocalVideoVisible(false);
            c2c_setRemoteVideoVisible(false);
            c2c_localVideo.srcObject = null;
            c2c_remoteVideo.srcObject = null;

            c2c_restoreCall = null;
        },

        callConfirmed: async function (call, message, cause) {
            c2c_ac_log('phone>>> callConfirmed');
            c2c_audioPlayer.stop();

            c2c_setLocalVideoVisible(c2c_isSelfVideo && c2c_activeCall.hasSendVideo());
            c2c_setRemoteVideoVisible(c2c_activeCall.hasReceiveVideo());

            c2c_gui_phoneDuringCall();

            c2c_info('Call is established', true);

            if (c2c_restoreCall !== null) {
                if (c2c_restoreCall.hold.includes('remote')) {
                    c2c_ac_log('Restore remote hold');
                    c2c_info('Hold');
                    c2c_activeCall.setRemoteHoldState();
                }

                if (c2c_restoreCall.screenSharing) {
                    c2c_ac_log('Restore screen sharing');
                    c2c_screenSharingToggle();
                }
            } else {
                if (c2c_dtmfSequence !== null) {
                    if (c2c_dtmfDelay > 0) {
                        c2c_ac_log(`Wait ${c2c_dtmfDelay}ms before DTMF sending...`);
                        await c2c_delay(c2c_dtmfDelay);
                    }

                    c2c_ac_log(`Send DTMF sequence: ${c2c_dtmfSequence}`);
                    for (let key of c2c_dtmfSequence) {
                        c2c_activeCall.sendDTMF(key);
                    }
                }
            }

            if (!c2c_hasMicrophone) {
                c2c_info('Warning: No microphone');
                c2c_ac_log('Play "noMicrophoneSound"');
                c2c_audioPlayer.play(c2c_soundConfig.play.noMicrophoneSound, c2c_streamDest);
            }
        },

        callShowStreams: function (call, localStream, remoteStream) {
            c2c_ac_log('phone>>> callShowStreams');
            c2c_audioPlayer.stop();

            // The speaker selection works only in Chrome (except iOS Chrome)
            if (!c2c_devices) {
                c2c_remoteVideo.srcObject = remoteStream;
                c2c_remoteVideo.volume = 1.0;
            } else {
                c2c_setRemoteVideoSinkId()
                    .catch((e) => {
                        c2c_ac_log(`Warning: remove video HTMLVideoElement.setSinkId(): "${e.message}" [Used default browser speaker]`, e);
                    })
                    .finally(() => {
                        c2c_remoteVideo.srcObject = remoteStream;
                        c2c_remoteVideo.volume = 1.0;
                    });
            }

            if (c2c_isSelfVideo && c2c_activeCall.hasSendVideo())
                c2c_showSelfVideo(true);
        },

        incomingCall: function (call, invite) {
            c2c_ac_log('phone>>> incomingCall');
            call.reject();
        },

        callHoldStateChanged: function (call, isHold, isRemote) {
            c2c_ac_log('phone>>> callHoldStateChanged');
            if (call.isRemoteHold()) {
                c2c_gui_phoneOnRemoteHold()
            } else {
                c2c_gui_phoneDuringCall();
            }
        },

        callIncomingReinvite: function (call, start, request) {
            if (start) {
                call.data['screen-sharing-header'] = request.getHeader('x-screen-sharing');
                return;
            }
            c2c_setRemoteVideoVisible(call.hasReceiveVideo());

            if (call.hasReceiveVideo() && !call.hasSendVideo() && c2c_hasCamera) {
                if (!call.hasEnabledSendVideo()) {
                    // Other side add video
                    c2c_info('You are invited to turn on your camera', true);
                } else {
                    c2c_ac_log('Other side disable receive video for video call');
                }
            }

            // Detecting that remote side start/stop sending screen sharing.
            let screenSharing = call.data['screen-sharing-header'];
            if (call.hasReceiveVideo() && screenSharing === 'on') {
                c2c_ac_log('Started receiving remote screen sharing');
            } else if (screenSharing === 'off') {
                c2c_ac_log('Stopped receiving remote screen sharing');
            }
        },

        incomingNotify: function (call, eventName, from, contentType, body, request) {
            c2c_ac_log(`phone>>> incoming NOTIFY "${eventName}"`, call, from, contentType, body);
            if (call !== null)
                return false; // Skip in dialog NOTIFY.

            // AudioCodes out of dialog NOTIFY with voice quality
            if (eventName === 'vq') {
                let vq = getXVoiceQuality(request);
                if (vq) {
                    c2c_ac_log(`NOTIFY: "X-VoiceQuality" header: score="${vq.score}", color="${vq.color}"`);
                } else {
                    c2c_ac_log('NOTIFY: missing "X-VoiceQuality" header');
                }
                return true;
            } else {
                return false;
            }
        },

        callScreenSharingEnded: function (call, stream) {
            c2c_ac_log('phone>>> callScreenSharingEnded');
            c2c_screenSharingButton.title = 'Start screen sharing';
            c2c_screenSharingButton.disabled = false;
            if (c2c_cameraButton)
                c2c_cameraButton.disabled = false;
            c2c_phone.closeScreenSharing(c2c_screenSharingStream);
            c2c_screenSharingStream = null;
        }
    });

    c2c_sbcDisconnectCounter = 0;

    // Other side allowed to add video for call type: 'video' or 'user_control'
    // call type 'audio' is limited to audio only.
    c2c_phone.setEnableAddVideo(c2c_config.type !== 'audio');
    c2c_phone.setNetworkPriority(c2c_config.networkPriority);
    c2c_phone.setModes(c2c_config.modes);
    c2c_phone.init(false);
}

// AudioCodes X-VoiceQuality header parser
function getXVoiceQuality(request) {
    let header = request.getHeader('X-VoiceQuality');
    if (!header) {
        return undefined;
    }
    let words = header.trim().split(' ');
    if (words.length !== 2) {
        console.log('X-VoiceQuality header: parsing problem: must be 2 tokens');
        return undefined;
    }
    let score = parseInt(words[0]);
    if (isNaN(score)) {
        console.log('X-VoiceQuality header: parsing problem: the first token is not number');
        return undefined;
    }
    let color = words[1].trim().toLowerCase();
    return { score, color };
}

// Prepare restore call after page reload.
function c2c_onBeforeUnload() {
    c2c_ac_log('phone>>> beforeunload event');
    if (c2c_phone === null || !c2c_phone.isInitialized())
        return;
    if (c2c_activeCall !== null) {
        if (c2c_activeCall.isEstablished()) {
            let data = {
                callTo: c2c_activeCall.data['_user'],
                video: c2c_activeCall.getVideoState(), // sendrecv, sendonly, recvonly, inactive
                replaces: c2c_activeCall.getReplacesHeader(),
                time: new Date().getTime(),
                hold: `${c2c_activeCall.isLocalHold() ? 'local' : ''}${c2c_activeCall.isRemoteHold() ? 'remote' : ''}`,
                address: c2c_phone.getServerAddress(),
                selfVideo: c2c_isSelfVideo
            }
            if (c2c_activeCall.isScreenSharing()) {
                data.screenSharing = true;
                data.video = c2c_activeCall.doesScreenSharingReplaceCamera() ? 'sendrecv' : 'inactive';
            }
            sessionStorage.setItem('c2c_restoreCall', JSON.stringify(data));
        } else {
            c2c_activeCall.terminate(); // send BYE or CANCEL
        }
    }
}

function c2c_videoOption() {
    if (!c2c_hasCamera)
        return c2c_phone.AUDIO;
    switch (c2c_config.type) {
        case 'audio':
            return c2c_phone.AUDIO;
        case 'video':
            return c2c_phone.VIDEO;
        case 'user_control':
            return c2c_videoCheckbox.checked ? c2c_phone.VIDEO : c2c_phone.AUDIO;
        default:
            c2c_ac_log(`Warning: c2c_videoOption(): Illegal value of c2c_config.type Used: 'audio'`);
            return c2c_phone.AUDIO;
    }
}

function c2c_selectDevices() {
    c2c_ac_log('c2c_selectDevices()');
    c2c_info('');
    document.getElementById('select_devices_done_btn').onclick = c2c_selectDevicesDone;
    c2c_devices.enumerate(true)
        .catch((e) => {
            c2c_ac_log('getUserMedia() exception', e);
        })
        .finally(() => {
            for (let name of c2c_devices.names) {
                c2c_fillDeviceList(name);
            }
            c2c_gui_DeviceSelection();
        });
}

function c2c_fillDeviceList(name) {
    let device = c2c_devices.getDevice(name); // name is one of 'microphone', 'speaker', 'camera', 'ringer'
    let selector = document.querySelector(`#c2c_devices [name="${name}"]`);
    // Clear select push-down list
    while (selector.firstChild) {
        selector.removeChild(selector.firstChild);
    }
    if (device.incomplete) {
        selector.disabled = true;
        c2c_ac_log(`Warning: To device selection let enable ${name} usage`);
    } else {
        selector.disabled = false;
    }
    // Loop by device labels and add option elements.
    for (let ix = 0; ix < device.list.length; ix++) {
        let dev = device.list[ix]
        let option = document.createElement("option");
        option.textContent = dev.label;  // Use textContent to prevent XSS from device names
        option.value = ix.toString(); // index in device list
        option.selected = (device.index === ix); // selected device
        selector.add(option);
    }

    // Hide camera selection for audio only call.
    if (name === 'camera' && c2c_config.type === 'audio') {
        document.getElementById('camera_dev').style.display = 'none';
        return;
    }

    document.getElementById(`${name}_dev`).style.display = (device.list.length > 1) ? 'block' : 'none';
}

function c2c_selectDevicesDone() {
    for (let name of c2c_devices.names) {
        let selectElement = document.querySelector(`#c2c_devices [name="${name}"]`);
        let index = selectElement.selectedIndex;
        if (index !== -1) { // -1 indicates that no element is selected
            let n = selectElement.options[index].value;
            c2c_devices.setSelectedIndex(name, parseInt(n));
        }
    }

    let selectedDevices = c2c_devices.store();

    // To restore after page reload.
    sessionStorage.setItem('c2c_selectedDevices', JSON.stringify(selectedDevices));

    let str = 'Devices done: selected';
    for (let name of c2c_devices.names) {
        if (c2c_devices.getNumber(name) > 1) {
            str += `\n${name}: "${c2c_devices.getSelected(name).label}"`;
        }
    }
    c2c_ac_log(str);

    let micId = c2c_devices.getSelected('microphone').deviceId;
    c2c_phone.setConstraint('audio', 'deviceId', micId);

    let camId = c2c_devices.getSelected('camera').deviceId;
    c2c_phone.setConstraint('video', 'deviceId', camId);

    let spkrId = c2c_devices.getSelected('speaker').deviceId;
    c2c_audioPlayer.setSpeakerId(spkrId);

    c2c_gui_phoneBeforeCall();
}

function c2c_setRemoteVideoSinkId() {
    let deviceId = c2c_devices.getSelected('speaker').deviceId;
    if (deviceId === null)
        deviceId = ''; // remove sinkId
    if (c2c_remoteVideoDeviceId === deviceId) {
        c2c_ac_log('c2c: remote video: sinkId is already assigned');
        return Promise.resolve();
    }
    if (!c2c_remoteVideo.setSinkId) {
        return Promise.reject(new Error('setSinkId is not implemented'));
    }
    c2c_ac_log(`c2c: remove video: setSinkId "${deviceId}"`);
    c2c_remoteVideo.srcObject = null; // probably setSinkId check srcObject
    return c2c_remoteVideo.setSinkId(deviceId)
        .then(() => {
            c2c_ac_log(`c2c: remote video: setSinkId completed`);
            c2c_remoteVideoDeviceId = deviceId;
        });
}

function c2c_cameraToggle() {
    c2c_ac_log('c2c_cameraToggle()');
    c2c_info('');
    if (!c2c_activeCall.hasEnabledSendVideo()) {
        if (c2c_cameraButton)
            c2c_cameraButton.disabled = true;
        c2c_activeCall.startSendingVideo()
            .then(() => {
                c2c_gui_phoneDuringCall();
                if (c2c_isSelfVideo) {
                    c2c_showSelfVideo(true);
                }
                c2c_setRemoteVideoVisible(c2c_activeCall.hasReceiveVideo());
            })
            .catch((e) => {
                c2c_ac_log('c2c error during start video', e);
            })
            .finally(() => {
                if (c2c_cameraButton)
                    c2c_cameraButton.disabled = false;
            });
    } else {
        c2c_activeCall.stopSendingVideo()
            .then(() => {
                c2c_gui_phoneDuringCall();
                if (c2c_isSelfVideo) {
                    c2c_showSelfVideo(false);
                }
                c2c_setRemoteVideoVisible(c2c_activeCall.hasReceiveVideo());
            })
            .catch((e) => {
                c2c_ac_log('stop sending video failure', e);
            })
            .finally(() => {
                if (c2c_cameraButton)
                    c2c_cameraButton.disabled = false;
            });
    }
}

async function c2c_call() {
    // Call optional c2c_create_header function
    // to fill X header. The header will be added to initial INVITE.
    if (typeof (c2c_create_x_header) === 'function') {
        try {
            c2c_x_header = c2c_create_x_header();
        } catch (e) {
            c2c_info(e);
            c2c_ac_log('Exception in function c2c_create_x_header', e);
            return;
        }
    }

    if (c2c_sbcDisconnectTimer !== null) {
        clearTimeout(c2c_sbcDisconnectTimer);
        c2c_sbcDisconnectTimer = null;
    }

    c2c_isStartCall = true;
    c2c_audioPlayer.stop();

    c2c_gui_phoneCalling();

    if (!c2c_phone.isInitialized()) {
        try {
            // the call will start when the sbc is connected
            await c2c_sbc_connect_sequence();
        } catch (e) {
            c2c_ac_log('phone initialization or SBC connecting error:', e);
            c2c_info(e);
            c2c_gui_phoneBeforeCall();
        }
    } else if (c2c_isWsConnected) {
        c2c_startCall();
    } else {
        c2c_ac_log('SIP is already initialized. websocket is disconnected. Wait connection...');
    }
}

async function c2c_sbc_connect_sequence() {
    c2c_info('Connecting');
    c2c_initStack({ user: c2c_config.caller, displayName: c2c_config.callerDN, password: '' });
}

function c2c_startCall() {
    c2c_isStartCall = false;
    c2c_makeCall(c2c_config.call, c2c_videoOption());
}

function c2c_makeCall(callTo, videoMode, extraHeaders = []) {
    c2c_isStartCall = false; 
    let extraOptions = {};
    if (c2c_activeCall !== null)
        throw 'Already exists active call';

    c2c_info('Calling', true);
    if (c2c_serverConfig.iceTransportPolicyRelay && c2c_usedTurnServer) {
        c2c_ac_log("Used TURN debugging iceTransportPolicy: 'relay'");
        extraOptions.pcConfig = { iceTransportPolicy: 'relay' };
    }

    // Normally used microphone sound.
    if (!c2c_hasMicrophone) {
        // Prepare media stream to play recorded sound.
        c2c_streamDest = c2c_audioPlayer.audioCtx.createMediaStreamDestination();
        extraOptions.mediaStream = c2c_streamDest.stream;
    }

    // Add user defined SIP X header if present.
    if (c2c_x_header) {
        extraHeaders.push(c2c_x_header);
    }
    // Add security token if present.
    if (c2c_token) {
        extraHeaders.push(`X-Token: ${c2c_token}`);
    }

    c2c_activeCall = c2c_phone.call(videoMode, callTo, extraHeaders, extraOptions);
}

function c2c_hangupCall() {
    if (c2c_activeCall !== null) {
        c2c_activeCall.terminate();
        c2c_activeCall = null;
    }
}


function c2c_setVideoVisible(elem, visible) {
    let es = elem.style;
    es.display = 'block';
    if (visible) {
        es.width = c2c_config.videoSize.width;
        es.height = c2c_config.videoSize.height;
    } else {
        es.width = 0;
        es.height = 0;
    }
}

function c2c_setLocalVideoVisible(visible) {
    c2c_setVideoVisible(c2c_localVideo, visible);
}

function c2c_setRemoteVideoVisible(visible) {
    c2c_setVideoVisible(c2c_remoteVideo, visible);
}

function c2c_selfVideoToggle() {
    c2c_ac_log('c2c_selfVideoToggle()');
    c2c_isSelfVideo = c2c_selfVideoChk.checked;
    c2c_showSelfVideo(c2c_isSelfVideo);
}

function c2c_showSelfVideo(show) {
    if (show && c2c_activeCall !== null && c2c_activeCall.hasSendVideo()) {
        c2c_ac_log('show self-video');
        c2c_localVideo.srcObject = c2c_activeCall.getRTCLocalStream();
        c2c_localVideo.volume = 0;
        c2c_setLocalVideoVisible(true);
    } else {
        c2c_ac_log('hide self-video');
        c2c_localVideo.srcObject = null;
        c2c_setLocalVideoVisible(false);
    }
}


// Display message, and optionally clean it after delay.
// Uses textContent for security (prevents XSS)
function c2c_info(text, clear = false) {
    c2c_status_line.textContent = text;
    c2c_status_line.dataset.id = ++c2c_messageId;
    if (clear) {
        (function (id) {
            setTimeout(() => {
                if (c2c_status_line.dataset.id === id) {
                    c2c_status_line.textContent = '';
                }
            }, c2c_config.messageDisplayTime * 1000);
        })(c2c_status_line.dataset.id);
    }
}

function c2c_keypadToggle() {
    if (getComputedStyle(c2c_keypadDiv).getPropertyValue('display') === 'none') {
        c2c_ac_log('show keypad');
        c2c_keypadDiv.style.display = 'block';
    } else {
        c2c_ac_log('hide keypad');
        c2c_keypadDiv.style.display = 'none';
    }
}

function c2c_sendDtmf(key) {
    if (c2c_activeCall) {
        c2c_audioPlayer.play(Object.assign({ 'name': key }, c2c_soundConfig.play.dtmf));
        c2c_activeCall.sendDTMF(key);
    }
}

// Start/stop screen sharing. To screen sharing used the same video track as for sending video.
async function c2c_screenSharingToggle() {
    if (c2c_activeCall === null) {
        c2c_ac_log('screenSharingToggle: no active call');
        return;
    }
    if (!c2c_activeCall.isScreenSharing()) {
        return Promise.resolve()
            .then(() => {
                if (c2c_screenSharingStream === null) {
                    return c2c_phone.openScreenSharing()
                        .then(stream => {
                            c2c_screenSharingStream = stream;
                        });
                }
            })
            .then(() => {
                c2c_screenSharingButton.disabled = true;
                if (c2c_cameraButton)
                    c2c_cameraButton.disabled = true;
                return c2c_activeCall.startScreenSharing(c2c_screenSharingStream);
            })
            .then(() => {
                // Optional check if other side receive the video.
                if (!c2c_activeCall.hasSendVideo()) {
                    c2c_ac_log('Warning: Currently other side does not accept the screen sharing video');
                }
            })
            .catch((e) => {
                c2c_ac_log('guiScreenSharing: error: ' + e);
                if (c2c_cameraButton)
                    c2c_cameraButton.disabled = false;
            })
            .finally(() => {
                c2c_screenSharingButton.title = 'Stop screen sharing';
                c2c_screenSharingButton.disabled = false;
            });
    } else {
        // Note: GUI updated in callScreenSharingEnded callback
        return c2c_activeCall.stopScreenSharing();
    }
}

/*
   Settings Modal: Load current config into the modal form
*/
function c2c_loadSettingsToModal() {
    document.getElementById('cfg_domain').value = c2c_serverConfig.domain || '';
    let addr = c2c_serverConfig.addresses;
    let addrStr = '';
    if (Array.isArray(addr)) {
        addrStr = addr.map(a => (Array.isArray(a) ? a[0] : a)).join(', ');
    } else {
        addrStr = String(addr);
    }
    document.getElementById('cfg_addresses').value = addrStr;
    document.getElementById('cfg_call').value = c2c_config.call || '';
    document.getElementById('cfg_caller').value = c2c_config.caller || '';
    document.getElementById('cfg_callerDN').value = c2c_config.callerDN || '';
    document.getElementById('cfg_type').value = c2c_config.type || 'audio';
    document.getElementById('cfg_callAutoStart').checked = !!(c2c_config.callAutoStart && c2c_config.callAutoStart !== 'no');
    document.getElementById('cfg_selectDevicesEnabled').checked = !!c2c_config.selectDevicesEnabled;
    document.getElementById('cfg_dtmfKeypadEnabled').checked = !!c2c_config.dtmfKeypadEnabled;
    document.getElementById('cfg_screenSharingEnabled').checked = !!c2c_config.screenSharingEnabled;
    document.getElementById('cfg_selfVideoEnabled').checked = !!c2c_config.selfVideoEnabled;
}

/*
   Settings Modal: Save values from modal into c2c_config / c2c_serverConfig
*/
function c2c_saveSettingsFromModal() {
    let domain = document.getElementById('cfg_domain').value.trim();
    let addresses = document.getElementById('cfg_addresses').value.trim();
    let call = document.getElementById('cfg_call').value.trim();
    let caller = document.getElementById('cfg_caller').value.trim();
    let callerDN = document.getElementById('cfg_callerDN').value.trim();
    let type = document.getElementById('cfg_type').value;
    let callAutoStart = document.getElementById('cfg_callAutoStart').checked;
    let selectDevicesEnabled = document.getElementById('cfg_selectDevicesEnabled').checked;
    let dtmfKeypadEnabled = document.getElementById('cfg_dtmfKeypadEnabled').checked;
    let screenSharingEnabled = document.getElementById('cfg_screenSharingEnabled').checked;
    let selfVideoEnabled = document.getElementById('cfg_selfVideoEnabled').checked;

    // Apply
    if (domain) c2c_serverConfig.domain = domain;
    if (addresses) {
        c2c_serverConfig.addresses = addresses.split(',').map(s => {
            s = s.trim();
            if (!s.startsWith('wss://') && !s.startsWith('ws://')) {
                s = 'wss://' + s;
            }
            return s;
        });
    }
    if (call) c2c_config.call = call;
    if (caller) c2c_config.caller = caller;
    if (callerDN) c2c_config.callerDN = callerDN;
    if (type) c2c_config.type = type;
    c2c_config.callAutoStart = callAutoStart ? 'yes' : 'no';
    c2c_config.selectDevicesEnabled = selectDevicesEnabled;
    c2c_config.dtmfKeypadEnabled = dtmfKeypadEnabled;
    c2c_config.screenSharingEnabled = screenSharingEnabled;
    c2c_config.selfVideoEnabled = selfVideoEnabled;

    // Save to sessionStorage so it persists across page reloads
    sessionStorage.setItem('c2c_ui_config', JSON.stringify({
        domain: c2c_serverConfig.domain,
        addresses: c2c_serverConfig.addresses,
        call: c2c_config.call,
        caller: c2c_config.caller,
        callerDN: c2c_config.callerDN,
        type: c2c_config.type,
        callAutoStart: c2c_config.callAutoStart,
        selectDevicesEnabled: c2c_config.selectDevicesEnabled,
        dtmfKeypadEnabled: c2c_config.dtmfKeypadEnabled,
        screenSharingEnabled: c2c_config.screenSharingEnabled,
        selfVideoEnabled: c2c_config.selfVideoEnabled,
        _adApplied: false  // manual save = not from AD
    }));

    c2c_ac_log('Settings saved. Reloading page to apply...');
    // Reload to re-init with new config
    location.reload();
}

/*
   Load settings from sessionStorage (if available) into config objects
*/
function c2c_loadSettingsFromStorage() {
    let data = sessionStorage.getItem('c2c_ui_config');
    if (data === null) return;
    try {
        let saved = JSON.parse(data);
        if (saved.domain) c2c_serverConfig.domain = saved.domain;
        if (saved.addresses) c2c_serverConfig.addresses = saved.addresses;
        if (saved.call) c2c_config.call = saved.call;
        if (saved.caller) c2c_config.caller = saved.caller;
        if (saved.callerDN) c2c_config.callerDN = saved.callerDN;
        if (saved.type) c2c_config.type = saved.type;
        if (saved.callAutoStart !== undefined) c2c_config.callAutoStart = saved.callAutoStart;
        if (saved.selectDevicesEnabled !== undefined) c2c_config.selectDevicesEnabled = saved.selectDevicesEnabled;
        if (saved.dtmfKeypadEnabled !== undefined) c2c_config.dtmfKeypadEnabled = saved.dtmfKeypadEnabled;
        if (saved.screenSharingEnabled !== undefined) c2c_config.screenSharingEnabled = saved.screenSharingEnabled;
        if (saved.selfVideoEnabled !== undefined) c2c_config.selfVideoEnabled = saved.selfVideoEnabled;
        c2c_ac_log('Loaded saved settings from sessionStorage' + (saved._adApplied ? ' (from AD)' : ''));
    } catch (e) {
        c2c_ac_log('Error loading saved settings', e);
    }
}

/* =============================================
   Device Test: Camera Preview, Mic & Speaker
   ============================================= */

// Toggle device test panel open/close
function c2c_toggleDeviceTest() {
    if (c2c_deviceTestDiv.style.display === 'block') {
        c2c_closeDeviceTest();
    } else {
        c2c_openDeviceTest();
    }
}

function c2c_openDeviceTest() {
    c2c_deviceTestDiv.style.display = 'block';
    c2c_deviceTestBtn.classList.add('active');
    // Hide other panels
    if (c2c_selectDevicesDiv) c2c_selectDevicesDiv.style.display = 'none';
    if (c2c_keypadDiv) c2c_keypadDiv.style.display = 'none';
    c2c_ac_log('Device test panel opened');
}

function c2c_closeDeviceTest() {
    c2c_deviceTestDiv.style.display = 'none';
    c2c_deviceTestBtn.classList.remove('active');
    // Stop camera preview
    if (c2c_cameraPreviewStream) {
        c2c_cameraPreviewStream.getTracks().forEach(t => t.stop());
        c2c_cameraPreviewStream = null;
    }
    c2c_cameraPreview.style.display = 'none';
    if (c2c_cameraPreviewPlaceholder) c2c_cameraPreviewPlaceholder.style.display = 'flex';
    c2c_cameraPreviewBtn.innerText = 'Start Camera';
    c2c_cameraPreviewBtn.classList.remove('active');
    // Stop mic test
    c2c_stopMicTest();
    c2c_ac_log('Device test panel closed');
}

// --- Camera Preview ---
async function c2c_toggleCameraPreview() {
    if (c2c_cameraPreviewStream) {
        // Stop
        c2c_cameraPreviewStream.getTracks().forEach(t => t.stop());
        c2c_cameraPreviewStream = null;
        c2c_cameraPreview.style.display = 'none';
        if (c2c_cameraPreviewPlaceholder) c2c_cameraPreviewPlaceholder.style.display = 'flex';
        c2c_cameraPreviewBtn.innerText = 'Start Camera';
        c2c_cameraPreviewBtn.classList.remove('active');
        c2c_ac_log('Camera preview stopped');
        return;
    }
    try {
        // Use the selected camera device if available
        let constraints = { video: true, audio: false };
        if (c2c_devices) {
            let cam = c2c_devices.getSelected('camera');
            if (cam && cam.deviceId) {
                constraints.video = { deviceId: { exact: cam.deviceId } };
            }
        }
        let stream = await navigator.mediaDevices.getUserMedia(constraints);
        c2c_cameraPreviewStream = stream;
        c2c_cameraPreview.srcObject = stream;
        c2c_cameraPreview.style.display = 'block';
        if (c2c_cameraPreviewPlaceholder) c2c_cameraPreviewPlaceholder.style.display = 'none';
        c2c_cameraPreviewBtn.innerText = 'Stop Camera';
        c2c_cameraPreviewBtn.classList.add('active');
        c2c_ac_log('Camera preview started');
    } catch (e) {
        c2c_ac_log('Camera preview error:', e);
        if (c2c_cameraPreviewPlaceholder) {
            c2c_cameraPreviewPlaceholder.innerHTML = '<span style="color:#FF3B30">Camera error: ' + c2c_escapeHtml(String(e.message || 'Unknown error')) + '</span>';
        }
    }
}

// --- Microphone Level Meter ---
async function c2c_toggleMicTest() {
    if (c2c_micTestActive) {
        c2c_stopMicTest();
        return;
    }
    try {
        let constraints = { audio: true, video: false };
        if (c2c_devices) {
            let mic = c2c_devices.getSelected('microphone');
            if (mic && mic.deviceId) {
                constraints.audio = { deviceId: { exact: mic.deviceId } };
            }
        }
        let stream = await navigator.mediaDevices.getUserMedia(constraints);
        c2c_micTestStream = stream;
        c2c_micTestActive = true;
        c2c_micTestBtn.innerText = 'Stop Mic Test';
        c2c_micTestBtn.classList.add('active');

        // Set up analyser
        let audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        let source = audioCtx.createMediaStreamSource(stream);
        let analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        c2c_micAnalyser = analyser;

        // Start meter loop
        function updateMeter() {
            if (!c2c_micTestActive) return;
            let data = new Uint8Array(analyser.frequencyBinCount);
            analyser.getByteFrequencyData(data);
            let avg = data.reduce((a, b) => a + b, 0) / data.length;
            let pct = Math.min(100, (avg / 128) * 100);
            let db = Math.round(20 * Math.log10((avg + 1) / 128));
            c2c_micLevelFill.style.width = pct + '%';
            c2c_micLevelText.innerText = db + ' dB';
            // Color coding
            if (pct < 20) c2c_micLevelFill.style.background = 'linear-gradient(90deg, var(--success), var(--warning))';
            else if (pct < 60) c2c_micLevelFill.style.background = 'linear-gradient(90deg, var(--success), var(--warning), var(--danger))';
            else c2c_micLevelFill.style.background = 'var(--danger)';
            c2c_micTestRaf = requestAnimationFrame(updateMeter);
        }
        updateMeter();
        c2c_ac_log('Mic test started');
    } catch (e) {
        c2c_ac_log('Mic test error:', e);
        c2c_micLevelText.innerText = 'Error: ' + (e.message || 'Unknown error');
    }
}

function c2c_stopMicTest() {
    c2c_micTestActive = false;
    if (c2c_micTestRaf) {
        cancelAnimationFrame(c2c_micTestRaf);
        c2c_micTestRaf = null;
    }
    if (c2c_micTestStream) {
        c2c_micTestStream.getTracks().forEach(t => t.stop());
        c2c_micTestStream = null;
    }
    c2c_micAnalyser = null;
    c2c_micLevelFill.style.width = '0%';
    c2c_micLevelText.innerText = '- dB';
    c2c_micTestBtn.innerText = 'Start Mic Test';
    c2c_micTestBtn.classList.remove('active');
    c2c_ac_log('Mic test stopped');
}

// --- Speaker Test ---
async function c2c_playSpeakerTest() {
    c2c_speakerTestBtn.disabled = true;
    c2c_speakerTestBtn.innerText = 'Playing...';
    c2c_speakerTestResult.innerHTML = '';

    try {
        // Generate a simple tone using Web Audio API
        let audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        let oscillator = audioCtx.createOscillator();
        let gainNode = audioCtx.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = 440; // A4
        gainNode.gain.value = 0.3;
        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        // Use selected speaker if available
        if (c2c_devices && c2c_remoteVideo && typeof c2c_remoteVideo.setSinkId === 'function') {
            let spkr = c2c_devices.getSelected('speaker');
            if (spkr && spkr.deviceId) {
                try {
                    await c2c_remoteVideo.setSinkId(spkr.deviceId);
                    // Create MediaElement to route audio through setSinkId
                    let silentAudio = new Audio();
                    await silentAudio.setSinkId(spkr.deviceId);
                    let dest = audioCtx.createMediaElementDestination();
                    gainNode.connect(dest);
                    silentAudio.srcObject = dest.stream;
                    silentAudio.play();
                } catch (e) {
                    c2c_ac_log('Speaker routing via setSinkId failed, using default:', e);
                }
            }
        }

        oscillator.start();
        c2c_audioPlayer.playShortSound({ name: 'ringingTone', volume: 0.3 });
        c2c_speakerTestResult.innerHTML = '<span class="check">✓ Playing</span> Test tone (440Hz) through speaker';
        c2c_ac_log('Speaker test: playing tone');
        
        // Stop after 2 seconds
        setTimeout(() => {
            try {
                oscillator.stop();
                oscillator.disconnect();
            } catch (e) {}
            c2c_speakerTestBtn.disabled = false;
            c2c_speakerTestBtn.innerText = 'Play Test Sound';
            c2c_speakerTestBtn.classList.add('success');
            c2c_speakerTestResult.innerHTML = '<span class="check">✓ Done</span> Did you hear the tone?';
            setTimeout(() => {
                c2c_speakerTestBtn.classList.remove('success');
            }, 2000);
        }, 2000);
    } catch (e) {
        c2c_ac_log('Speaker test error:', e);
        c2c_speakerTestResult.innerHTML = '<span class="cross">✗ Error:</span> ' + c2c_escapeHtml(String(e.message || 'Unknown error'));
        c2c_speakerTestBtn.disabled = false;
        c2c_speakerTestBtn.innerText = 'Play Test Sound';
    }
}

/*
   1. phone disabled 
   2. before call
   3. when calling
   4. during call   
   5. call on remote hold    
 */
function c2c_gui_phoneDisabled(msg) {
    c2c_ac_log(msg);
    c2c_callButton.disabled = true;
    c2c_callButton.className = 'vct-call-btn disabled';
    c2c_callButton.querySelector('.vct-call-btn-label').innerText = 'Disabled';
}

function c2c_gui_phoneBeforeCall() {

    // Show select devices button
    if (c2c_config.selectDevicesEnabled) {
        c2c_selectDevicesButton.style.display = 'inline-flex';
        c2c_selectDevicesButton.disabled = false;
        c2c_selectDevicesDiv.style.display = 'none';
    }

    // Show device test button
    if (c2c_deviceTestBtn) {
        c2c_deviceTestBtn.style.display = 'inline-flex';
        c2c_deviceTestBtn.disabled = false;
    }

    // Show call button
    c2c_callButton.style.display = 'inline-flex';
    c2c_callButton.disabled = false;
    c2c_callButton.className = 'vct-call-btn ready';
    c2c_callButton.querySelector('.vct-call-btn-label').innerText = 'Call';
    c2c_callButton.title = c2c_callButtonTitle;
    // Call button handler
    c2c_callButtonHandler = function () { c2c_call(); }

    // Show audio/video checkbox
    if (c2c_videoSpan) {
        let showVideoCheckbox = c2c_config.type === 'user_control' && c2c_hasCamera;
        c2c_videoSpan.style.display = showVideoCheckbox ? 'inline-flex' : 'none';

        if (c2c_videoCheckbox) {
            c2c_videoCheckbox.checked = c2c_config.videoCheckboxDefault;
        }
    }

    // Hide camera button
    if (c2c_cameraButton) {
        c2c_cameraButton.style.display = 'none';
        if (c2c_cameraLineSvg) {
            c2c_cameraButton.style.display = 'none';
        }
    }

    // Hide keypad and keypad button.
    if (c2c_keypadButton) {
        c2c_keypadButton.style.display = 'none';
        c2c_keypadDiv.style.display = 'none';
    }

    // Hide show yourself checkbox
    if (c2c_selfVideoSpan) {
        c2c_selfVideoSpan.style.display = 'none';
    }

    // Hide screen sharing button.
    if (c2c_screenSharingButton) {
        c2c_screenSharingButton.style.display = 'none';
    }
}

function c2c_gui_DeviceSelection() {
    // Show select devices DIV
    c2c_selectDevicesDiv.style.display = 'block';

    // Hide not used GUI elements
    c2c_selectDevicesButton.style.display = 'none';
    c2c_callButton.style.display = 'none';
    if (c2c_videoSpan) {
        c2c_videoSpan.style.display = 'none';
    }
    if (c2c_cameraButton) {
        c2c_cameraButton.style.display = 'none';
        if (c2c_cameraLineSvg) {
            c2c_cameraButton.style.display = 'none';
        }
    }
}

function c2c_gui_phoneCalling() {
    // Hide select devices button
    if (c2c_selectDevicesButton) {
        c2c_selectDevicesButton.style.display = 'none';
    }

    // Modify call button look (to hangup)
    c2c_callButton.className = 'vct-call-btn calling';
    c2c_callButton.querySelector('.vct-call-btn-label').innerText = 'Calling...';
    c2c_callButton.title = 'Hang up';
    // Set the button handler to hangup.
    c2c_callButtonHandler = c2c_hangupCall;

    // Hide video check box span
    if (c2c_videoSpan) {
        c2c_videoSpan.style.display = 'none';
    }
}

function c2c_gui_phoneOnRemoteHold() {
    c2c_ac_log('phone on remote hold');
    // TODO: show the state
}

function c2c_gui_phoneDuringCall() {
    if (c2c_videoSpan) {
        c2c_videoSpan.style.display = 'none';
    }
    c2c_callButton.className = 'vct-call-btn hangup';
    c2c_callButton.querySelector('.vct-call-btn-label').innerText = 'Hangup';

    if (c2c_config.type === 'user_control' && c2c_hasCamera) {
        if (c2c_cameraButton && c2c_cameraLineSvg) {
            c2c_cameraButton.style.display = 'inline-flex';
            c2c_cameraButton.title = c2c_activeCall.hasEnabledSendVideo() ? 'turn camera off' : 'turn camera on';
            c2c_cameraLineSvg.setAttribute('class', c2c_activeCall.hasEnabledSendVideo() ? 'c2c_camera_on' : 'c2c_camera_off');
        }
    }

    if (c2c_screenSharingButton) {
        c2c_screenSharingButton.style.display = 'inline-flex';
    }

    if (c2c_keypadButton) {
        c2c_keypadButton.style.display = 'inline-flex';
    }

    if (c2c_selfVideoSpan && c2c_hasCamera && c2c_activeCall.hasSendVideo()) {
        c2c_selfVideoSpan.style.display = 'inline-flex';
    } else {
        c2c_selfVideoSpan.style.display = 'none';
    }

    // Hide device test button during call
    if (c2c_deviceTestBtn) {
        c2c_deviceTestBtn.style.display = 'none';
        c2c_closeDeviceTest();
    }
}

// ──────────────────────────────────────────────
// Authentication-aware initialization
// ──────────────────────────────────────────────

// Session data from server
let c2c_sessionData = null;

/**
 * Check session with server and apply AD config if authenticated.
 * Shows login button if not authenticated, or user button if authenticated.
 */
async function c2c_initAuth() {
    try {
        const resp = await fetch('/api/session', { credentials: 'same-origin' });
        const data = await resp.json();

        if (data.authenticated) {
            c2c_sessionData = data;
            c2c_ac_log(`[Auth] Authenticated as: ${data.user}`);

            // Apply AD attributes to config
            c2c_applyADConfig(data.attributes);

            // Show user button, hide login button (query DOM directly)
            const loginBtn = document.getElementById('c2c_login_btn');
            const userBtn = document.getElementById('c2c_user_btn');
            if (loginBtn) loginBtn.style.display = 'none';
            if (userBtn) {
                userBtn.style.display = 'inline-flex';
                userBtn.title = `Signed in as ${data.user}`;
            }

            // Proceed with normal initialization
            c2c_init();
        } else {
            // Not authenticated — show login button
            c2c_ac_log('[Auth] Not authenticated. Showing login button.');
            const loginBtn = document.getElementById('c2c_login_btn');
            const userBtn = document.getElementById('c2c_user_btn');
            if (loginBtn) {
                loginBtn.style.display = 'inline-flex';
                loginBtn.title = 'Sign in';
                loginBtn.onclick = function () {
                    window.location.href = '/html/login.html';
                };
            }
            if (userBtn) userBtn.style.display = 'none';

            // Still load the phone but with default config
            c2c_init();
        }
    } catch (e) {
        c2c_ac_log('[Auth] Session check failed (server may be starting):', e);
        // Proceed without auth
        const loginBtn = document.getElementById('c2c_login_btn');
        if (loginBtn) {
            loginBtn.style.display = 'inline-flex';
            loginBtn.onclick = function () {
                window.location.href = '/html/login.html';
            };
        }
        c2c_init();
    }
}

/**
 * Apply AD/LDAP attributes to c2c runtime configuration.
 * Maps: domain, addresses, call, caller, callerDN
 */
function c2c_applyADConfig(attrs) {
    if (!attrs) return;

    c2c_ac_log('[Auth] Applying AD attributes to config:');
    
    // domain
    if (attrs.domain) {
        c2c_serverConfig.domain = attrs.domain;
        c2c_ac_log(`  domain = ${attrs.domain}`);
    }
    
    // addresses — only apply if it's a non-empty array or non-empty string
    if (attrs.addresses) {
        if (Array.isArray(attrs.addresses) && attrs.addresses.length > 0) {
            c2c_serverConfig.addresses = attrs.addresses;
        } else if (typeof attrs.addresses === 'string' && attrs.addresses.trim()) {
            c2c_serverConfig.addresses = attrs.addresses.split(',').map(s => {
                s = s.trim();
                if (!s.startsWith('ws://') && !s.startsWith('wss://')) {
                    s = 'wss://' + s;
                }
                return s;
            });
        } else {
            c2c_ac_log(`  addresses skipped (empty or invalid)`);
        }
        if (Array.isArray(c2c_serverConfig.addresses)) {
            c2c_ac_log(`  addresses = ${JSON.stringify(c2c_serverConfig.addresses)}`);
        }
    }
    
    // call
    if (attrs.call) {
        c2c_config.call = attrs.call;
        c2c_ac_log(`  call = ${attrs.call}`);
    }
    
    // caller
    if (attrs.caller) {
        c2c_config.caller = attrs.caller;
        c2c_ac_log(`  caller = ${attrs.caller}`);
    }
    
    // callerDN
    if (attrs.callerDN) {
        c2c_config.callerDN = attrs.callerDN;
        c2c_ac_log(`  callerDN = ${attrs.callerDN}`);
    }

    // Save to sessionStorage so it persists across page reloads
    sessionStorage.setItem('c2c_ui_config', JSON.stringify({
        domain: c2c_serverConfig.domain,
        addresses: c2c_serverConfig.addresses,
        call: c2c_config.call,
        caller: c2c_config.caller,
        callerDN: c2c_config.callerDN,
        type: c2c_config.type,
        callAutoStart: c2c_config.callAutoStart,
        selectDevicesEnabled: c2c_config.selectDevicesEnabled,
        dtmfKeypadEnabled: c2c_config.dtmfKeypadEnabled,
        screenSharingEnabled: c2c_config.screenSharingEnabled,
        selfVideoEnabled: c2c_config.selfVideoEnabled,
        _adApplied: true
    }));

    c2c_debugAddEntry('info', '[Auth] AD config applied: domain=' + attrs.domain + ' call=' + attrs.call + ' caller=' + attrs.caller);
}

// Setup auth button handlers once DOM is ready
function c2c_setupAuthHandlers() {
    // User button → open user menu (use direct DOM query)
    const userBtn = document.getElementById('c2c_user_btn');
    if (userBtn) {
        userBtn.onclick = function () {
            c2c_openUserMenu();
        };
    }
    // User menu close
    const userMenuCloseBtn = document.getElementById('c2c_user_menu_close_btn');
    if (userMenuCloseBtn) {
        userMenuCloseBtn.onclick = function () {
            const modal = document.getElementById('c2c_user_menu_modal');
            if (modal) modal.style.display = 'none';
        };
    }
    // Close modal on overlay click
    const userMenuModal = document.getElementById('c2c_user_menu_modal');
    if (userMenuModal) {
        userMenuModal.onclick = function (e) {
            if (e.target === userMenuModal) {
                userMenuModal.style.display = 'none';
            }
        };
    }
    // Logout button
    const logoutBtn = document.getElementById('c2c_logout_btn');
    if (logoutBtn) {
        logoutBtn.onclick = async function () {
            try {
                await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' });
            } catch (e) {}
            // Clear session storage
            sessionStorage.removeItem('c2c_ui_config');
            sessionStorage.removeItem('c2c_restoreCall');
            // Redirect to login
            window.location.href = '/html/login.html';
        };
    }
}

/**
 * Open user menu and populate with session data
 */
function c2c_openUserMenu() {
    if (!c2c_sessionData) {
        // Try to fetch fresh session data
        fetch('/api/session', { credentials: 'same-origin' })
            .then(r => r.json())
            .then(data => {
                if (data.authenticated) {
                    c2c_sessionData = data;
                    c2c_populateUserMenu(data);
                }
            })
            .catch(() => {});
        return;
    }
    c2c_populateUserMenu(c2c_sessionData);
}

function c2c_populateUserMenu(data) {
    const attrs = data.attributes || {};
    
    document.getElementById('c2c_user_display_name').textContent = attrs.callerDN || data.user;
    document.getElementById('c2c_user_username').textContent = '@' + data.user;
    document.getElementById('c2c_attr_domain').textContent = attrs.domain || '-';
    
    let addrStr = '';
    if (Array.isArray(attrs.addresses)) {
        addrStr = attrs.addresses.join(', ');
    } else {
        addrStr = attrs.addresses || '-';
    }
    document.getElementById('c2c_attr_addresses').textContent = addrStr;
    document.getElementById('c2c_attr_call').textContent = attrs.call || '-';
    document.getElementById('c2c_attr_caller').textContent = attrs.caller || '-';
    document.getElementById('c2c_attr_callerDN').textContent = attrs.callerDN || '-';
    
    c2c_userMenuModal.style.display = 'flex';
}

// ── Start with auth check ───────────────────
// This replaces the original c2c_init() call at the bottom
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        c2c_setupAuthHandlers();
        c2c_initAuth();
    });
} else {
    c2c_setupAuthHandlers();
    c2c_initAuth();
}

/*
  The optional function c2c_create_x_header() 
  Please comment if not used.

  It allows fill some arbitrary HTML form before call
  and send collected data as SIP INVITE X-Header.  
  Web Designer should modify the code according used HTML form.

function c2c_create_x_header() {
    // E.g. used form with 3 required parts.
    let name = document.getElementById('customer_name').value.trim();
    let mobile = document.getElementById('customer_mobile').value.trim();
    let address = document.getElementById('customer_address').value.trim();

    // The function can throw exception.
    // Click-to-call show the exception in status line and not called.
    if( name === '')
      throw 'Missed name';
    if( mobile === '')
      throw 'Missed phone number';
    if( address === '')
      throw 'Missed address';

    // Note:
    // If form fields are optional and not filled,
    // the function can return null (instead string)
    // In the case click-to-call start call, the x-header is not created.
	
    // Create SIP X header.
    let json = JSON.stringify({name, mobile, address});
    return 'X-Customer-Information: ' + json; 
}
*/