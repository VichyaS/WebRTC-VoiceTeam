//
// Click to call phone configuration.
// ⚠ IMPORTANT: Replace placeholder values with your actual SBC/server details before deploying.
//
let c2c_serverConfig = {
    domain: 'YOUR_SBC_DOMAIN',                    // ← REPLACE: SBC domain name e.g. sbc.yourcompany.com
    addresses: ['wss://YOUR_SBC_DOMAIN:443'],     // ← REPLACE: SBC WebSocket address (can be multiple)
    //addresses: '_take_value_from_url_',          // Uncomment to use URL 'server' parameter instead
	  
    iceServers: [],                               // Optional STUN/TURN servers (set in production)
    
    iceTransportPolicyRelay: false                 // If true, relay ICE candidates only

    // Optional websocket logger server
    // logger: 'example.com/wslog'
};

let c2c_config = {
    // Call
    call: '1000',              // ← REPLACE: SIP user / number to call
    caller: '1000',            // ← REPLACE: SIP caller user name (must match SBC config)
    callerDN: 'Voice Team',    // Caller display name
    type: 'user_control',      // Call type: 'audio', 'video', or 'user_control'
    videoCheckboxDefault: false,
    videoSize: { width: '480px', height: '360px' },
    callAutoStart: 'no',
    messageDisplayTime: 5,
    restoreCallMaxDelay: 20,
    allowCallWithoutMicrophone: true,
    networkPriority: undefined,
    urlToken: false,

    // Optional test call to check line quality.
    testCallEnabled: true,   // If test call enabled (show test call button)
    testCallUser: '5555',     // Call to this user for test call (It's special test call user in SBC that auto answer and play sound prompt)
    testCallDuration: 10,     // INVITE request URL "duration" value
    testCallAutoStart: false,  // Start test call automatically after page loading when auto play policy enable play sound or when for test call used microphone.
    testCallUseMicrophone: false, // Send microphone sound (true) or generated sound (false)
    testCallSBCScore: true,    // Use SBC voice quality score (true) or browser-based test (false) 
    testCallMinDuration: 10,  // Minimum test call duration in seconds
    testCallMaxDuration: 20,  // Maximum test call duration in seconds
    testCallVolume: 0.8,      // Test call audio volume
    testCallQualityText: {    // SBC voice quality score descriptions
        green: 'Good',
        yellow: 'Medium',
        red: 'Poor'
    },

    /* 
     * Optional. To select microphone, camera and speaker.
     *
     * Microphone and camera selection works in all browsers.
     *
     * Speaker selection works only in Chrome (with some exceptions): 
     * Works in Windows Chrome.
     * Don't work in iOS Chrome. (It's iOS design limitation)
     * Does not always work in Android Chrome (Probably it depends of Android version and used headset type)
     */
    selectDevicesEnabled: true,

    // Optional. DTMF keypad. Sending DTMF during call.
    dtmfKeypadEnabled: true,

    // Optional. Show video from local camera. 
    selfVideoEnabled: true,
    selfVideoCheckboxDefault: false,

    // Optional. Screen sharing video.
    screenSharingEnabled: true,

    // Websocket keep alive.
    pingInterval: 5,          // Keep alive ping interval,  0 value means don't send pings. (seconds)
    pongTimeout: true,         // Close and reopen websocket when pong timeout detected
    timerThrottlingBestEffort: true, // Action if timer throttling detected (for Chrome increase ping interval)
    pongReport: 60,       // if 0 not print, otherwise each N pongs print min and max pong delay 
    pongDist: false,      // Print to console log also pong delay distribution.    

    keepConnectionAfterCall: 30, // Keep websocket connection to SBC some time after call termination. 
    // Should be less than configured in SBC disconnection interval to prevent unnecessary reconnection attemts.
    // SDK modes
    modes: {
        ice_timeout_fix: 2000,             // ICE gathering timeout (milliseconds)
        chrome_rtp_timeout_fix: 13,        // Workaround of https://bugs.chromium.org/p/chromium/issues/detail?id=982793
    }
};


// Player plays generated tones or downloaded mp3 from sounds sub-directory.
let c2c_soundConfig = {
    generateTones: {
        ringingTone: [{ f: 400, t: 1.5 }, { t: 3.5 }],
        busyTone: [{ f: 400, t: 0.5 }, { t: 0.5 }],
        disconnectTone: [{ f: 400, t: 0.5 }, { t: 0.5 }],
        sirenTone: [{ f: 400, t: 1.0 }, { f: 300, t: 0.5 }]
    },

    downloadSounds: [
        //'flowing_stream'
    ],

    play: {
        outgoingCallProgress: { name: 'ringingTone', loop: true, volume: 0.2 },
        busy: { name: 'busyTone', volume: 0.2, repeat: 4 },
        disconnect: { name: 'disconnectTone', volume: 0.2, repeat: 3 },
        noMicrophoneSound: { name: 'sirenTone', loop: true, volume: 0.1 },
        testCallSound: { name: 'flowing_stream', loop: true, volume: 0.3 },
        dtmf: { volume: 0.15 }
    },
};