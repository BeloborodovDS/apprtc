/*
 *  Copyright (c) 2014 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */

/* More information about these options at jshint.com/docs/options */

/* globals trace, requestIceServers, sendUrlRequest, sendAsyncUrlRequest,
   SignalingChannel, PeerConnectionClient, setupLoopback,
   parseJSON, apprtc, Constants */

/* exported Call */

'use strict';

var Call = function(params) {
  this.params_ = params;
  this.roomServer_ = params.roomServer || '';

  this.channel_ = new SignalingChannel(params.wssUrl, params.wssPostUrl);
  this.channel_.onmessage = this.onRecvSignalingChannelMessage_.bind(this);

  this.pcClient_ = null;
  this.errorMessageQueue_ = [];
  this.startTime = null;

  // Public callbacks. Keep it sorted.
  this.oncallerstarted = null;
  this.onerror = null;
  this.oniceconnectionstatechange = null;
  this.onnewicecandidate = null;
  this.onremotehangup = null;
  this.onremotesdpset = null;
  this.onremotestreamadded = null;
  this.onsignalingstatechange = null;
  this.onturnstatusmessage = null;

  this.getMediaPromise_ = null;
  this.getIceServersPromise_ = null;
  this.requestMediaAndIceServers_();
};

Call.prototype.requestMediaAndIceServers_ = function() {
  this.getIceServersPromise_ = this.maybeGetIceServers_();
};

Call.prototype.isInitiator = function() {
  return this.params_.isInitiator;
};

Call.prototype.start = function(roomId) {
  this.connectToRoom_(roomId);
  if (this.params_.isLoopback) {
    setupLoopback(this.params_.wssUrl, roomId);
  }
};

Call.prototype.restart = function() {
  // Reinitialize the promises so the media gets hooked up as a result
  this.requestMediaAndIceServers_();
  this.start(this.params_.previousRoomId);
};

Call.prototype.hangup = function(async) {
  this.startTime = null;

  if (!this.params_.roomId) {
    return;
  }

  if (this.pcClient_) {
    this.pcClient_.close();
    this.pcClient_ = null;
  }

  // Send 'leave' to GAE. This must complete before saying BYE to other client.
  // When the other client sees BYE it attempts to post offer and candidates to
  // GAE. GAE needs to know that we're disconnected at that point otherwise
  // it will forward messages to this client instead of storing them.

  // This section of code is executed in both sync and async depending on
  // where it is called from. When the browser is closed, the requests must
  // be executed as sync to finish before the browser closes. When called
  // from pressing the hang up button, the requests are executed async.

  var steps = [];
  steps.push({
    step: function() {
      // Send POST request to /leave.
      var path = this.getLeaveUrl_();
      return sendUrlRequest('POST', path, async);
    }.bind(this),
    errorString: 'Error sending /leave:'
  });
  steps.push({
    step: function() {
      // Send bye to the other client.
      this.channel_.send(JSON.stringify({type: 'bye'}));
    }.bind(this),
    errorString: 'Error sending bye:'
  });
  steps.push({
    step: function() {
      // Close signaling channel.
      return this.channel_.close(async);
    }.bind(this),
    errorString: 'Error closing signaling channel:'
  });
  steps.push({
    step: function() {
      this.params_.previousRoomId = this.params_.roomId;
      this.params_.roomId = null;
      this.params_.clientId = null;
    }.bind(this),
    errorString: 'Error setting params:'
  });

  if (async) {
    var errorHandler = function(errorString, error) {
      trace(errorString + ' ' + error.message);
    };
    var promise = Promise.resolve();
    for (var i = 0; i < steps.length; ++i) {
      promise = promise.then(steps[i].step).catch(
          errorHandler.bind(this, steps[i].errorString));
    }

    return promise;
  }
  // Execute the cleanup steps.
  var executeStep = function(executor, errorString) {
    try {
      executor();
    } catch (ex) {
      trace(errorString + ' ' + ex);
    }
  };

  for (var j = 0; j < steps.length; ++j) {
    executeStep(steps[j].step, steps[j].errorString);
  }

  if (this.params_.roomId !== null || this.params_.clientId !== null) {
    trace('ERROR: sync cleanup tasks did not complete successfully.');
  } else {
    trace('Cleanup completed.');
  }
  return Promise.resolve();
};

Call.prototype.getLeaveUrl_ = function() {
  return this.roomServer_ + '/leave/' + this.params_.roomId +
      '/' + this.params_.clientId;
};

Call.prototype.onRemoteHangup = function() {
  this.startTime = null;

  // On remote hangup this client becomes the new initiator.
  this.params_.isInitiator = true;

  if (this.pcClient_) {
    this.pcClient_.close();
    this.pcClient_ = null;
  }

  this.startSignaling_();
};

Call.prototype.getPeerConnectionStates = function() {
  if (!this.pcClient_) {
    return null;
  }
  return this.pcClient_.getPeerConnectionStates();
};

Call.prototype.getPeerConnectionStats = function(callback) {
  if (!this.pcClient_) {
    return;
  }
  this.pcClient_.getPeerConnectionStats(callback);
};

// Connects client to the room. This happens by simultaneously requesting
// media, requesting turn, and join the room. Once all three of those
// tasks is complete, the signaling process begins. At the same time, a
// WebSocket connection is opened using |wss_url| followed by a subsequent
// registration once GAE registration completes.
Call.prototype.connectToRoom_ = function(roomId) {
  this.params_.roomId = roomId;
  // Asynchronously open a WebSocket connection to WSS.
  // TODO(jiayl): We don't need to wait for the signaling channel to open before
  // start signaling.
  var channelPromise = this.channel_.open().catch(function(error) {
    this.onError_('WebSocket open error: ' + error.message);
    return Promise.reject(error);
  }.bind(this));

  // Asynchronously join the room.
  var joinPromise =
      this.joinRoom_().then(function(roomParams) {
        // The only difference in parameters should be clientId and isInitiator,
        // and the turn servers that we requested.
        // TODO(tkchin): clean up response format. JSHint doesn't like it.

        this.params_.clientId = roomParams.client_id;
        this.params_.roomId = roomParams.room_id;
        this.params_.roomLink = roomParams.room_link;
        this.params_.isInitiator = roomParams.is_initiator === 'true';

        this.params_.messages = roomParams.messages;
      }.bind(this)).catch(function(error) {
        this.onError_('Room server join error: ' + error.message);
        return Promise.reject(error);
      }.bind(this));

  // We only register with WSS if the web socket connection is open and if we're
  // already registered with GAE.
  Promise.all([channelPromise, joinPromise]).then(function() {
    this.channel_.register(this.params_.roomId, this.params_.clientId);

    // We only start signaling after we have registered the signaling channel
    // and have media and TURN. Since we send candidates as soon as the peer
    // connection generates them we need to wait for the signaling channel to be
    // ready.
    Promise.all([this.getIceServersPromise_, this.getMediaPromise_])
        .then(function() {
          this.startSignaling_();
        }.bind(this)).catch(function(error) {
          this.onError_('Failed to start signaling: ' + error.message);
        }.bind(this));
  }.bind(this)).catch(function(error) {
    this.onError_('WebSocket register error: ' + error.message);
  }.bind(this));
};

// Asynchronously request an ICE server if needed.
Call.prototype.maybeGetIceServers_ = function() {
  var shouldRequestIceServers =
      (this.params_.iceServerRequestUrl &&
      this.params_.iceServerRequestUrl.length > 0 &&
      this.params_.peerConnectionConfig.iceServers &&
      this.params_.peerConnectionConfig.iceServers.length === 0);

  var iceServerPromise = null;
  if (shouldRequestIceServers) {
    var requestUrl = this.params_.iceServerRequestUrl;
    iceServerPromise =
        requestIceServers(requestUrl, this.params_.iceServerTransports).then(
            function(iceServers) {
              var servers = this.params_.peerConnectionConfig.iceServers;
              this.params_.peerConnectionConfig.iceServers =
              servers.concat(iceServers);
            }.bind(this)).catch(function(error) {
          if (this.onturnstatusmessage) {
            // Error retrieving ICE servers.
            var subject =
                encodeURIComponent('AppRTC demo ICE servers not working');
            this.onturnstatusmessage(
                'No TURN server; unlikely that media will traverse networks.');
          }
          trace(error.message);
        }.bind(this));
  } else {
    iceServerPromise = Promise.resolve();
  }
  return iceServerPromise;
};

Call.prototype.maybeCreatePcClientAsync_ = function() {
  return new Promise(function(resolve, reject) {
    if (this.pcClient_) {
      resolve();
      return;
    }

    if (typeof RTCPeerConnection.generateCertificate === 'function') {
      var certParams = {name: 'ECDSA', namedCurve: 'P-256'};
      RTCPeerConnection.generateCertificate(certParams)
          .then(function(cert) {
            trace('ECDSA certificate generated successfully.');
            this.params_.peerConnectionConfig.certificates = [cert];
            this.createPcClient_();
            resolve();
          }.bind(this))
          .catch(function(error) {
            trace('ECDSA certificate generation failed.');
            reject(error);
          });
    } else {
      this.createPcClient_();
      resolve();
    }
  }.bind(this));
};

Call.prototype.createPcClient_ = function() {
  this.pcClient_ = new PeerConnectionClient(this.params_, this.startTime);
  this.pcClient_.onsignalingmessage = this.sendSignalingMessage_.bind(this);
  this.pcClient_.onremotehangup = this.onremotehangup;
  this.pcClient_.onremotesdpset = this.onremotesdpset;
  this.pcClient_.onremotestreamadded = this.onremotestreamadded;
  this.pcClient_.onsignalingstatechange = this.onsignalingstatechange;
  this.pcClient_.oniceconnectionstatechange = this.oniceconnectionstatechange;
  this.pcClient_.onnewicecandidate = this.onnewicecandidate;
  this.pcClient_.onerror = this.onerror;
  trace('Created PeerConnectionClient');
};

Call.prototype.startSignaling_ = function() {
  trace('Starting signaling.');
  if (this.isInitiator() && this.oncallerstarted) {
    this.oncallerstarted(this.params_.roomId, this.params_.roomLink);
  }

  this.startTime = window.performance.now();

  this.maybeCreatePcClientAsync_()
      .then(function() {
        if (this.params_.isInitiator) {
          this.pcClient_.startAsCaller(this.params_.offerOptions);
        } else {
          this.pcClient_.startAsCallee(this.params_.messages);
        }
      }.bind(this))
      .catch(function(e) {
        this.onError_('Create PeerConnection exception: ' + e);
        alert('Cannot create RTCPeerConnection: ' + e.message);
      }.bind(this));
};

// Join the room and returns room parameters.
Call.prototype.joinRoom_ = function() {
  return new Promise(function(resolve, reject) {
    if (!this.params_.roomId) {
      reject(Error('Missing room id.'));
    }
    var path = this.roomServer_ + '/join/' +
        this.params_.roomId + window.location.search;

    sendAsyncUrlRequest('POST', path).then(function(response) {
      var responseObj = parseJSON(response);
      if (!responseObj) {
        reject(Error('Error parsing response JSON.'));
        return;
      }
      if (responseObj.result !== 'SUCCESS') {
        // TODO (chuckhays) : handle room full state by returning to room
        // selection state.
        // When room is full, responseObj.result === 'FULL'
        reject(Error('Registration error: ' + responseObj.result));
        if (responseObj.result === 'FULL') {
          var getPath = this.roomServer_ + '/r/' +
              this.params_.roomId + window.location.search;
          window.location.assign(getPath);
        }
        return;
      }
      trace('Joined the room.');
      resolve(responseObj.params);
    }.bind(this)).catch(function(error) {
      reject(Error('Failed to join the room: ' + error.message));
      return;
    }.bind(this));
  }.bind(this));
};

Call.prototype.onRecvSignalingChannelMessage_ = function(msg) {
  this.maybeCreatePcClientAsync_()
      .then(this.pcClient_.receiveSignalingMessage(msg));
};

Call.prototype.sendSignalingMessage_ = function(message) {
  var msgString = JSON.stringify(message);
  if (this.params_.isInitiator) {
    // Initiator posts all messages to GAE. GAE will either store the messages
    // until the other client connects, or forward the message to Collider if
    // the other client is already connected.
    // Must append query parameters in case we've specified alternate WSS url.
    var path = this.roomServer_ + '/message/' + this.params_.roomId +
        '/' + this.params_.clientId + window.location.search;
    var xhr = new XMLHttpRequest();
    xhr.open('POST', path, true);
    xhr.send(msgString);
    trace('C->GAE: ' + msgString);
  } else {
    this.channel_.send(msgString);
  }
};

Call.prototype.onError_ = function(message) {
  if (this.onerror) {
    this.onerror(message);
  }
};
