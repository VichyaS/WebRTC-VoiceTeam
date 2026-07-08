'use strict';
//  Browser voice quality test (for test call)
//
//  It's optional code (you can delete the file if not use it)
//  Note: Recommended to use SBC voice quality test instead.
//  
//  For G711 codecs. 
//  Checks percentage of lost packets and latency.
//
//  Works in Chrome (except iOS) and Firefox. 
//  Don't work in iOS/macOS Safari, iOS Chrome
async function c2c_browserVoiceQualityTest() {
    c2c_ac_log('Checking line quality (browser test)...');
    // Testing call quality.
    let qualityScore = undefined;
    try {
        qualityScore = await c2c_get_browser_voice_quality_score();
    } catch (e) {
        c2c_ac_log('call quality testing exception', e);
    }

    if (qualityScore === undefined) {
        if (c2c_testCallQualityDiv) {
            c2c_testCallQualityDiv.innerHTML = 'Test call quality: <span style="color: red;font-weight:bold">Failed</span>'
        }
        c2c_info('Test failed');
    } else {
        c2c_info('Test passed', true);
        if (c2c_testCallQualityDiv) {
            let scoreInterval = c2c_get_browser_score_interval(qualityScore);
            if (scoreInterval) {
                c2c_testCallQualityDiv.innerHTML = 'Test call quality: <span style="color:' +
                    scoreInterval.color + ';font-weight:bold">' +
                    scoreInterval.text + '</span>';
            } else {
                c2c_testCallQualityDiv.innerHTML = 'Test call quality: <span style="color: red;font-weight:bold">Cannot calculate score interval</span>'
            }
        }
    }
    // Hangup test call.
    c2c_ac_log('Testing RTP quality is finished');
    c2c_activeCall.terminate();
}

/* 
   Get getStats() reports every second.
   Stop after testCallMinDuration seconds if obtained score data.
   Stop after testCallMaxDuration seconds in any case. 
*/
async function c2c_get_browser_voice_quality_score() {
    let lastScore = undefined;
    let conn = c2c_activeCall.getRTCPeerConnection();
    let startTimeMs = Date.now();
    for (let i = 0; i < c2c_config.testCallMaxDuration; i++) {
        await c2c_delay(1000);
        let stats = await conn.getStats(null);
        let elapsedTime = (Date.now() - startTimeMs) / 1000;
        let reports = c2c_createReports(stats, ['inbound-rtp', 'remote-inbound-rtp', 'outbound-rtp', 'track', 'codec']);
        try {
            lastScore = c2c_calculateG711QualityScore(reports, elapsedTime);
        } catch (e) {
            c2c_ac_log(`time: ${Math.floor(elapsedTime)}s cannot calculate score: ` + e);
        }
        if (elapsedTime >= c2c_config.testCallMinDuration && lastScore !== undefined)
            break;
    }
    // Debugging. Print complete stats provided by the browser.
    let stats = await conn.getStats(null);
    let reports = c2c_createReports(stats);
    c2c_ac_log('Reports', reports);

    // Debugging. Print used audio codec if can be detected by stats.
    let audioCodecs = c2c_getAudioCodecString(reports);
    if (audioCodecs) {
        c2c_ac_log('Tested audio codecs=' + audioCodecs);
    }
    return lastScore;
}

// Working with RTCPeerConnection.getStats object.
function c2c_createReports(stats, typesList = undefined) {
    let reports = {};
    stats.forEach(entry => {
        let type = entry.type;
        if (typesList !== undefined && !typesList.includes(type))
            return;
        if (!reports[type])
            reports[type] = [];
        reports[type].push(Object.assign({}, entry));
    });
    return reports;
}

// Get codecs using RTCPeerConnection getStats report.
// Note: don't work in Firefox, because missed "codec" report
function c2c_getCodec(reports, isOut, isAudio) {
    // out or in ?
    let type = isOut ? 'outbound-rtp' : 'inbound-rtp';
    let rtps = reports[type];
    if (!rtps)
        throw `No "${type}" stats`;
    // audio or video ?
    let foundRtp = null;
    let mediaType = isAudio ? 'audio' : 'video';
    for (let rtp of rtps) {
        if (rtp.mediaType === mediaType) {
            foundRtp = rtp;
            break;
        }
    }
    if (!foundRtp) {
        return undefined;
    }
    let codecId = foundRtp.codecId;

    // search codec by codecId
    let codecs = reports['codec'];
    if (!codecs)
        throw 'No "codec" stats';
    for (let codec of codecs) {
        if (codec.id === codecId)
            return codec;
    }
    throw `No "codec" stats with id=="${codecId}"`;
}

// Get audio codec string if possible using getStats() reports.
function c2c_getAudioCodecString(reports) {
    let outAudio, inAudio;
    try {
        let outAudioCodec = c2c_getCodec(reports, true, true)
        let inAudioCodec = c2c_getCodec(reports, false, true);
        if (outAudioCodec === undefined)
            throw 'Stats: no outbound-rtp for audio';
        if (inAudioCodec === undefined)
            throw 'Stats: no inbound-rtp for audio';
        outAudio = outAudioCodec.mimeType.toUpperCase();
        inAudio = inAudioCodec.mimeType.toUpperCase();
        if (outAudio.startsWith('AUDIO/'))
            outAudio = outAudio.substring(6);
        if (inAudio.startsWith('AUDIO/'))
            inAudio = inAudio.substring(6);
    } catch (e) {
        c2c_ac_log('Exception during codecs detection', e);
        return undefined;
    }
    if (outAudio === inAudio)
        return outAudio;
    return 'out=' + outAudio + ' in=' + inAudio;
}

function c2c_getBoundRtp(reports, type, isAudio) {
    let kind = isAudio ? 'audio' : 'video';
    let rtps = reports[type];
    if (!rtps)
        throw `No "${type}" stats`;
    for (let rtp of rtps) {
        if (rtp.kind === kind)
            return rtp;
    }
    throw `No "${type}" with kind==${kind}`;
}

function c2c_getTrack(reports, boundRtp) {
    let id = boundRtp.trackId;
    let tracks = reports['track'];
    if (!tracks)
        throw 'No "track" stats';
    for (let track of tracks)
        if (track.id === id)
            return track;
    throw 'No track with id=' + id
}

function c2c_calculateG711QualityScore(reports, elapsedTime) {
    // get reports if exists (remote-inbound-rtp missed at start)
    let inboundRtp = c2c_getBoundRtp(reports, 'inbound-rtp', true);
    let remoteInboundRtp = c2c_getBoundRtp(reports, 'remote-inbound-rtp', true);

    let irPacketsReceived = inboundRtp.packetsReceived;
    let irPacketsLost = inboundRtp.packetsLost;
    let rirPacketsLost = remoteInboundRtp.packetsLost;
    let rirJitter = remoteInboundRtp.jitter;
    let rirRoundTripTime = remoteInboundRtp.roundTripTime;

    if (irPacketsReceived === undefined) throw 'packetsReceived is undefined';
    if (irPacketsLost === undefined) throw 'packetsLost is undefined';
    if (rirPacketsLost === undefined) throw 'packetsLost is undefined';
    if (rirJitter === undefined) throw 'jitter is undefined';
    if (rirRoundTripTime === undefined) throw 'roundTripTime is undefined';

    let track = undefined;
    let totalSamplesDuration;
    try {
        track = c2c_getTrack(reports, inboundRtp);
        totalSamplesDuration = track.totalSamplesDuration;
    } catch (e) {
        let packetDuration = elapsedTime / (irPacketsReceived + irPacketsLost);
        totalSamplesDuration = packetDuration * irPacketsReceived;
        //c2c_ac_log(`Warning: No "track" stats. Calculated packet duration= + ${packetDuration} totalSamplesDuration=${totalSamplesDuration}`);
    }
    if (totalSamplesDuration === undefined) throw 'totalSamplesDuration is undefined';
    let lossPercent = 100 * irPacketsLost / (irPacketsLost + irPacketsReceived);
    let delayMs = (rirJitter + rirRoundTripTime / 2 + totalSamplesDuration / irPacketsReceived) * 1000;
    let { score, info } = c2c_getG711QualityScore(lossPercent, delayMs);
    c2c_ac_log(`time: ${Math.floor(elapsedTime)}s inbound-rtp: packetsReceived=${irPacketsReceived} packetsLost=${irPacketsLost} remote-inbound-rtp: packetsLost=${rirPacketsLost} jitter=${rirJitter} roundTripTime=${rirRoundTripTime} ${track ? 'track:' : ' calculated:'} totalSamplesDuration=${totalSamplesDuration}\n${info}`);
    return score;
}

function c2c_get_browser_score_interval(score) {
    for (let scoreInterval of c2c_qualityScoreIntervals) {
        if (score < scoreInterval.score) {
            return scoreInterval;
        }
    }
    return undefined;
}

function c2c_getG711QualityScore(loss, delay) {
    let percentIndex = Math.floor(loss / 2)
    if (percentIndex >= c2c_qualityScoreMatrix.length) {
        percentIndex = c2c_qualityScoreMatrix.length - 1; // > 98% used the last line ==98%
    }
    let row = c2c_qualityScoreMatrix[percentIndex];
    let delayIndex = Math.floor(delay / 20);
    if (delayIndex >= row.length) {
        return { score: 0, info: `delay ${delay} is too big (out of matrix range 0..500ms), set score=0` };
    }
    let score = row[delayIndex];
    return { score: score, info: `qualityScore(loss=${loss.toFixed(1)}%, delay=${delay.toFixed(1)}ms) => scoreMatrix[${percentIndex},${delayIndex}] = ${score}` };
}

// Split quality scores to intervals.
const c2c_qualityScoreIntervals = [
    { score: 2.7, color: 'Red', text: 'Poor' },
    { score: 3.2, color: 'Orange', text: 'Fair' },
    { score: 3.7, color: 'Lightgreen', text: 'Good' },
    { score: 5, color: 'DarkGreen', text: 'Excellent' }
];

// Quality score matrix for G711 codec. Horizontal delay 0, 20, 40... 500 ms  Vertical packet loss percent 0, 2, 4, ...98
// Result is quality score (3=fair, 2=poor, threshold at 2.7)
const c2c_qualityScoreMatrix = [
    [4.2, 4.2, 4.2, 4.2, 4.2, 4.2, 4.1, 4.1, 4.1, 4.1, 4, 3.9, 3.8, 3.7, 3.6, 3.5, 3.4, 3.3, 3.2, 3.2, 3.1, 3, 2.9, 2.8, 2.8, 2.7],
    [4.1, 4.1, 4.1, 4, 4, 4, 4, 4, 3.9, 3.9, 3.8, 3.7, 3.6, 3.5, 3.4, 3.3, 3.2, 3.1, 3, 2.9, 2.8, 2.7, 2.6, 2.6, 2.5, 2.4],
    [3.9, 3.9, 3.9, 3.9, 3.9, 3.9, 3.8, 3.8, 3.8, 3.7, 3.7, 3.5, 3.4, 3.3, 3.2, 3.1, 2.9, 2.8, 2.7, 2.7, 2.6, 2.5, 2.4, 2.3, 2.3, 2.2],
    [3.8, 3.8, 3.8, 3.7, 3.7, 3.7, 3.7, 3.7, 3.6, 3.6, 3.4, 3.3, 3.2, 3.1, 3, 2.8, 2.7, 2.6, 2.5, 2.4, 2.4, 2.3, 2.2, 2.1, 2, 2],
    [3.7, 3.6, 3.6, 3.6, 3.6, 3.6, 3.5, 3.5, 3.4, 3.4, 3.3, 3.2, 3, 2.9, 2.8, 2.6, 2.5, 2.4, 2.3, 2.2, 2.2, 2.1, 2, 1.9, 1.9, 1.8],
    [3.5, 3.5, 3.4, 3.4, 3.4, 3.4, 3.4, 3.3, 3.3, 3.3, 3.1, 3, 2.9, 2.7, 2.6, 2.5, 2.4, 2.3, 2.2, 2.1, 2, 1.9, 1.8, 1.8, 1.7, 1.7],
    [3.3, 3.3, 3.3, 3.3, 3.3, 3.3, 3.3, 3.2, 3.2, 3.1, 3, 2.8, 2.7, 2.6, 2.4, 2.3, 2.2, 2.1, 2, 1.9, 1.8, 1.8, 1.7, 1.6, 1.6, 1.5],
    [3.2, 3.2, 3.2, 3.2, 3.1, 3.1, 3.1, 3.1, 3, 2.9, 2.8, 2.7, 2.6, 2.4, 2.3, 2.2, 2, 2, 1.9, 1.8, 1.7, 1.6, 1.6, 1.5, 1.5, 1.4],
    [3.1, 3.1, 3.1, 3, 3, 3, 3, 3, 2.9, 2.8, 2.7, 2.6, 2.4, 2.3, 2.2, 2, 1.9, 1.8, 1.8, 1.7, 1.6, 1.5, 1.5, 1.4, 1.4, 1.3],
    [3, 2.9, 2.9, 2.9, 2.9, 2.9, 2.8, 2.8, 2.8, 2.7, 2.6, 2.4, 2.3, 2.2, 2, 1.9, 1.8, 1.7, 1.6, 1.6, 1.5, 1.4, 1.4, 1.3, 1.3, 1.2],
    [2.8, 2.8, 2.8, 2.8, 2.8, 2.8, 2.7, 2.7, 2.6, 2.6, 2.4, 2.3, 2.2, 2.1, 1.9, 1.8, 1.7, 1.6, 1.5, 1.5, 1.4, 1.4, 1.3, 1.3, 1.2, 1.2],
    [2.7, 2.7, 2.7, 2.7, 2.7, 2.6, 2.6, 2.6, 2.5, 2.5, 2.3, 2.2, 2.1, 2, 1.8, 1.7, 1.6, 1.5, 1.5, 1.4, 1.3, 1.3, 1.2, 1.2, 1.2, 1.1],
    [2.6, 2.6, 2.6, 2.6, 2.6, 2.5, 2.5, 2.5, 2.4, 2.4, 2.2, 2.1, 2, 1.9, 1.8, 1.6, 1.5, 1.5, 1.4, 1.3, 1.3, 1.2, 1.2, 1.2, 1.1, 1.1],
    [2.5, 2.5, 2.5, 2.5, 2.5, 2.5, 2.4, 2.4, 2.3, 2.3, 2.1, 2, 1.9, 1.8, 1.7, 1.5, 1.5, 1.4, 1.3, 1.3, 1.2, 1.2, 1.1, 1.1, 1.1, 1.1],
    [2.5, 2.4, 2.4, 2.4, 2.4, 2.4, 2.3, 2.3, 2.3, 2.2, 2.1, 1.9, 1.8, 1.7, 1.6, 1.5, 1.4, 1.3, 1.3, 1.2, 1.2, 1.1, 1.1, 1.1, 1.1, 1],
    [2.4, 2.4, 2.3, 2.3, 2.3, 2.3, 2.3, 2.2, 2.2, 2.1, 2, 1.8, 1.8, 1.6, 1.5, 1.4, 1.4, 1.3, 1.2, 1.2, 1.1, 1.1, 1.1, 1.1, 1, 1],
    [2.3, 2.3, 2.3, 2.2, 2.2, 2.2, 2.2, 2.2, 2.1, 2, 1.9, 1.8, 1.7, 1.6, 1.5, 1.4, 1.3, 1.2, 1.2, 1.1, 1.1, 1.1, 1, 1, 1, 1],
    [2.2, 2.2, 2.2, 2.2, 2.1, 2.1, 2.1, 2.1, 2, 2, 1.8, 1.8, 1.6, 1.5, 1.4, 1.3, 1.3, 1.2, 1.2, 1.1, 1.1, 1, 1, 1, 1, 1],
    [2.2, 2.1, 2.1, 2.1, 2.1, 2.1, 2, 2, 2, 1.9, 1.8, 1.7, 1.6, 1.5, 1.4, 1.3, 1.2, 1.2, 1.1, 1.1, 1.1, 1, 1, 1, 1, 1],
    [2.1, 2.1, 2.1, 2, 2, 2, 2, 2, 1.9, 1.8, 1.8, 1.6, 1.5, 1.4, 1.3, 1.2, 1.2, 1.1, 1.1, 1.1, 1, 1, 1, 1, 1, 1],
    [2, 2, 2, 2, 2, 1.9, 1.9, 1.9, 1.8, 1.8, 1.7, 1.6, 1.5, 1.4, 1.3, 1.2, 1.2, 1.1, 1.1, 1, 1, 1, 1, 1, 1, 1],
    [2, 2, 1.9, 1.9, 1.9, 1.9, 1.9, 1.8, 1.8, 1.8, 1.6, 1.5, 1.4, 1.3, 1.3, 1.2, 1.1, 1.1, 1.1, 1, 1, 1, 1, 1, 1, 1],
    [1.9, 1.9, 1.9, 1.9, 1.8, 1.8, 1.8, 1.8, 1.8, 1.7, 1.6, 1.5, 1.4, 1.3, 1.2, 1.2, 1.1, 1.1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1.9, 1.9, 1.8, 1.8, 1.8, 1.8, 1.8, 1.8, 1.7, 1.7, 1.5, 1.4, 1.4, 1.3, 1.2, 1.1, 1.1, 1.1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1.8, 1.8, 1.8, 1.8, 1.8, 1.8, 1.8, 1.7, 1.7, 1.6, 1.5, 1.4, 1.3, 1.2, 1.2, 1.1, 1.1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1.8, 1.8, 1.8, 1.8, 1.7, 1.7, 1.7, 1.7, 1.6, 1.6, 1.5, 1.4, 1.3, 1.2, 1.2, 1.1, 1.1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1.8, 1.8, 1.7, 1.7, 1.7, 1.7, 1.7, 1.6, 1.6, 1.5, 1.4, 1.4, 1.3, 1.2, 1.1, 1.1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1.7, 1.7, 1.7, 1.7, 1.7, 1.6, 1.6, 1.6, 1.5, 1.5, 1.4, 1.3, 1.2, 1.2, 1.1, 1.1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1.7, 1.7, 1.7, 1.6, 1.6, 1.6, 1.6, 1.6, 1.5, 1.5, 1.4, 1.3, 1.2, 1.2, 1.1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1.7, 1.6, 1.6, 1.6, 1.6, 1.6, 1.5, 1.5, 1.5, 1.4, 1.4, 1.3, 1.2, 1.1, 1.1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1.6, 1.6, 1.6, 1.6, 1.5, 1.5, 1.5, 1.5, 1.5, 1.4, 1.3, 1.2, 1.2, 1.1, 1.1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1.6, 1.6, 1.6, 1.5, 1.5, 1.5, 1.5, 1.5, 1.4, 1.4, 1.3, 1.2, 1.2, 1.1, 1.1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1.6, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.4, 1.4, 1.3, 1.2, 1.1, 1.1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.4, 1.4, 1.3, 1.3, 1.2, 1.1, 1.1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1.5, 1.5, 1.5, 1.5, 1.5, 1.4, 1.4, 1.4, 1.4, 1.3, 1.2, 1.2, 1.1, 1.1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1.5, 1.5, 1.5, 1.4, 1.4, 1.4, 1.4, 1.4, 1.4, 1.3, 1.2, 1.2, 1.1, 1.1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1.5, 1.5, 1.4, 1.4, 1.4, 1.4, 1.4, 1.4, 1.3, 1.3, 1.2, 1.1, 1.1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1.4, 1.4, 1.4, 1.4, 1.4, 1.4, 1.4, 1.4, 1.3, 1.3, 1.2, 1.1, 1.1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1.4, 1.4, 1.4, 1.4, 1.4, 1.4, 1.4, 1.3, 1.3, 1.3, 1.2, 1.1, 1.1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1.4, 1.4, 1.4, 1.4, 1.4, 1.4, 1.3, 1.3, 1.3, 1.2, 1.2, 1.1, 1.1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1.4, 1.4, 1.4, 1.4, 1.3, 1.3, 1.3, 1.3, 1.3, 1.2, 1.2, 1.1, 1.1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1.4, 1.4, 1.4, 1.3, 1.3, 1.3, 1.3, 1.3, 1.2, 1.2, 1.1, 1.1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1.4, 1.4, 1.3, 1.3, 1.3, 1.3, 1.3, 1.3, 1.2, 1.2, 1.1, 1.1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1.3, 1.3, 1.3, 1.3, 1.3, 1.3, 1.3, 1.3, 1.2, 1.2, 1.1, 1.1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1.3, 1.3, 1.3, 1.3, 1.3, 1.3, 1.3, 1.2, 1.2, 1.2, 1.1, 1.1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1.3, 1.3, 1.3, 1.3, 1.3, 1.3, 1.2, 1.2, 1.2, 1.2, 1.1, 1.1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1.3, 1.3, 1.3, 1.3, 1.3, 1.2, 1.2, 1.2, 1.2, 1.2, 1.1, 1.1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1.3, 1.3, 1.3, 1.3, 1.2, 1.2, 1.2, 1.2, 1.2, 1.1, 1.1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1.3, 1.3, 1.3, 1.2, 1.2, 1.2, 1.2, 1.2, 1.2, 1.1, 1.1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1.3, 1.3, 1.2, 1.2, 1.2, 1.2, 1.2, 1.2, 1.2, 1.1, 1.1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
];