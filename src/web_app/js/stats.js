/*
 *  Copyright (c) 2014 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */

/* More information about these options at jshint.com/docs/options */

/* exported computeBitrate, computeE2EDelay, computeRate,
   enumerateStats, extractStatAsInt, refreshStats */

'use strict';

// Return the integer stat |statName| from the object with type |statObj| in
// |stats|, or null if not present.
function extractStatAsInt(stats, statObj, statName) {
  // Ignore stats that have a 'nullish' value.
  // The correct fix is indicated in
  // https://code.google.com/p/webrtc/issues/detail?id=3377.
  var str = extractStat(stats, statObj, statName);
  if (str) {
    var val = parseInt(str);
    if (val !== -1) {
      return val;
    }
  }
  return null;
}

// Return the stat |statName| from the object with type |statObj| in |stats|
// as a string, or null if not present.
function extractStat(stats, statObj, statName) {
  var report = getStatsReport(stats, statObj, statName);
  if (report && report[statName] !== -1) {
    return report[statName];
  }
  return null;
}

// Return the stats report with type |statObj| in |stats|, with the stat
// |statName| (if specified), and value |statVal| (if specified). Return
// undef if not present.
function getStatsReport(stats, statObj, statName, statVal) {
  var result = null;
  if (stats) {
    stats.forEach(function(report, stat) {
      if (report.type === statObj) {
        var found = true;
        // If |statName| is present, ensure |report| has that stat.
        // If |statVal| is present, ensure the value matches.
        if (statName) {
          var val = statName === 'id' ? report.id : report[statName];
          found = (statVal !== undefined) ? (val === statVal) : val;
        }
        if (found) {
          result = report;
        }
      }
    });
  }
  return result;
}

// Enumerates the new standard compliant stats using local and remote track ids.
function enumerateStats(stats, remoteTrackIds) {
  // Create an object structure with all the needed stats and types that we care
  // about. This allows to map the getStats stats to other stats names.
  var statsObject = {
    audio: {
      remote: {
        audioLevel: 0.0,
        bytesReceived: 0,
        clockRate: 0,
        codecId: '',
        fractionLost: 0,
        jitter: 0,
        mimeType: '',
        packetsLost: 0,
        packetsReceived: 0,
        payloadType: 0,
        timestamp: 0.0,
        trackId: '',
        transportId: '',
      }
    },
    video: {
      remote: {
        bytesReceived: 0,
        clockRate: 0,
        codecId: '',
        firCount: 0,
        fractionLost: 0,
        frameHeight: 0,
        framesDecoded: 0,
        framesDropped: 0,
        framesReceived: 0,
        frameWidth: 0,
        nackCount: 0,
        packetsLost: 0,
        packetsReceived: 0,
        payloadType: 0,
        pliCount: 0,
        qpSum: 0,
        timestamp: 0.0,
        trackId: '',
        transportId: '',
      }
    },
    connection: {
      availableOutgoingBitrate: 0,
      bytesReceived: 0,
      bytesSent: 0,
      consentRequestsSent: 0,
      currentRoundTripTime: 0.0,
      localCandidateId: '',
      localCandidateType: '',
      localIp: '',
      localPort: 0,
      localPriority: 0,
      localProtocol: '',
      localRelayProtocol: undefined,
      remoteCandidateId: '',
      remoteCandidateType: '',
      remoteIp: '',
      remotePort: 0,
      remotePriority: 0,
      remoteProtocol: '',
      requestsReceived: 0,
      requestsSent: 0,
      responsesReceived: 0,
      responsesSent: 0,
      timestamp: 0.0,
      totalRoundTripTime: 0.0,
    }
  };

  // Need to find the codec, local and remote ID's first.
  if (stats) {
    stats.forEach(function(report, stat) {
      switch(report.type) {
        case 'inbound-rtp':
          if (report.hasOwnProperty('trackId')) {
            if(report.trackId.indexOf(remoteTrackIds.audio) !== -1) {
              statsObject.audio.remote.bytesReceived = report.bytesReceived;
              statsObject.audio.remote.codecId = report.codecId;
              statsObject.audio.remote.fractionLost = report.fractionLost;
              statsObject.audio.remote.jitter = report.jitter;
              statsObject.audio.remote.packetsLost = report.packetsLost;
              statsObject.audio.remote.packetsReceived = report.packetsReceived;
              statsObject.audio.remote.timestamp = report.timestamp;
              statsObject.audio.remote.trackId = report.trackId;
              statsObject.audio.remote.transportId = report.transportId;
            }
            if (report.trackId.indexOf(remoteTrackIds.video) !== -1) {
              statsObject.video.remote.bytesReceived = report.bytesReceived;
              statsObject.video.remote.codecId = report.codecId;
              statsObject.video.remote.firCount = report.firCount;
              statsObject.video.remote.fractionLost = report.fractionLost;
              statsObject.video.remote.nackCount = report.nackCount;
              statsObject.video.remote.packetsLost = report.patsLost;
              statsObject.video.remote.packetsReceived = report.packetsReceived;
              statsObject.video.remote.pliCount = report.pliCount;
              statsObject.video.remote.qpSum = report.qpSum;
              statsObject.video.remote.timestamp = report.timestamp;
              statsObject.video.remote.trackId = report.trackId;
              statsObject.video.remote.transportId = report.transportId;
            }
          }
          break;
        case 'candidate-pair':
          if (report.hasOwnProperty('availableOutgoingBitrate')) {
            statsObject.connection.availableOutgoingBitrate =
                report.availableOutgoingBitrate;
            statsObject.connection.bytesReceived = report.bytesReceived;
            statsObject.connection.bytesSent = report.bytesSent;
            statsObject.connection.consentRequestsSent =
                report.consentRequestsSent;
            statsObject.connection.currentRoundTripTime =
                report.currentRoundTripTime;
            statsObject.connection.localCandidateId = report.localCandidateId;
            statsObject.connection.remoteCandidateId = report.remoteCandidateId;
            statsObject.connection.requestsReceived = report.requestsReceived;
            statsObject.connection.requestsSent = report.requestsSent;
            statsObject.connection.responsesReceived = report.responsesReceived;
            statsObject.connection.responsesSent = report.responsesSent;
            statsObject.connection.timestamp = report.timestamp;
            statsObject.connection.totalRoundTripTime =
               report.totalRoundTripTime;
          }
          break;
        default:
          return;
      }
    }.bind());

    // Using the codec, local and remote candidate ID's to find the rest of the
    // relevant stats.
    stats.forEach(function(report) {
      switch(report.type) {
        case 'track':
          if (report.hasOwnProperty('trackIdentifier')) {
            if (report.trackIdentifier.indexOf(remoteTrackIds.video) !== -1) {
              statsObject.video.remote.frameHeight = report.frameHeight;
              statsObject.video.remote.framesDecoded = report.framesDecoded;
              statsObject.video.remote.framesDropped = report.framesDropped;
              statsObject.video.remote.framesReceived = report.framesReceived;
              statsObject.video.remote.frameWidth = report.frameWidth;
            }
            if (report.trackIdentifier.indexOf(remoteTrackIds.audio) !== -1) {
              statsObject.audio.remote.audioLevel = report.audioLevel;
            }
          }
          break;
        case 'codec':
          if (report.hasOwnProperty('id')) {
            if (report.id.indexOf(statsObject.audio.remote.codecId) !== -1) {
              statsObject.audio.remote.clockRate = report.clockRate;
              statsObject.audio.remote.mimeType = report.mimeType;
              statsObject.audio.remote.payloadType = report.payloadType;
            }
            if (report.id.indexOf(statsObject.video.remote.codecId) !== -1) {
              statsObject.video.remote.clockRate = report.clockRate;
              statsObject.video.remote.mimeType = report.mimeType;
              statsObject.video.remote.payloadType = report.payloadType;
            }
          }
          break;
        case 'local-candidate':
          if (report.hasOwnProperty('id')) {
            if (report.id.indexOf(
                statsObject.connection.localCandidateId) !== -1) {
              statsObject.connection.localIp = report.ip;
              statsObject.connection.localPort = report.port;
              statsObject.connection.localPriority = report.priority;
              statsObject.connection.localProtocol = report.protocol;
              statsObject.connection.localType = report.candidateType;
              statsObject.connection.localRelayProtocol = report.relayProtocol;
            }
          }
          break;
        case 'remote-candidate':
          if (report.hasOwnProperty('id')) {
            if (report.id.indexOf(
                statsObject.connection.remoteCandidateId) !== -1) {
              statsObject.connection.remoteIp = report.ip;
              statsObject.connection.remotePort = report.port;
              statsObject.connection.remotePriority = report.priority;
              statsObject.connection.remoteProtocol = report.protocol;
              statsObject.connection.remoteType = report.candidateType;
            }
          }
          break;
        default:
          return;
      }
    }.bind());
  }
  return statsObject;
}

// Takes two stats reports and determines the rate based on two counter readings
// and the time between them (which is in units of milliseconds).
function computeRate(newReport, oldReport, statName) {
  var newVal = newReport[statName];
  var oldVal = (oldReport) ? oldReport[statName] : null;
  if (newVal === null || oldVal === null) {
    return null;
  }
  return (newVal - oldVal) / (newReport.timestamp - oldReport.timestamp) * 1000;
}

// Convert a byte rate to a bit rate.
function computeBitrate(newReport, oldReport, statName) {
  return computeRate(newReport, oldReport, statName) * 8;
}

// Computes end to end delay based on the capture start time (in NTP format)
// and the current render time (in seconds since start of render).
function computeE2EDelay(captureStart, remoteVideoCurrentTime) {
  if (!captureStart) {
    return null;
  }

  // Adding offset (milliseconds between 1900 and 1970) to get NTP time.
  var nowNTP = Date.now() + 2208988800000;
  return nowNTP - captureStart - remoteVideoCurrentTime * 1000;
}
