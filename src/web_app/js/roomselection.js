/*
 *  Copyright (c) 2015 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */

/* More information about these options at jshint.com/docs/options */

/* globals randomString, Storage, parseJSON */
/* exported RoomSelection */

'use strict';

var RoomSelection = function(roomSelectionDiv, uiConstants) {
  this.roomSelectionDiv_ = roomSelectionDiv;

  this.roomIdInput_ = this.roomSelectionDiv_.querySelector(
      uiConstants.roomSelectionInput);
  this.roomIdInputLabel_ = this.roomSelectionDiv_.querySelector(
      uiConstants.roomSelectionInputLabel);
  this.roomJoinButton_ = this.roomSelectionDiv_.querySelector(
      uiConstants.roomSelectionJoinButton);
  
  // Call onRoomIdInput_ now to validate initial state of input box.
  this.onRoomIdInput_();

  this.roomIdInputListener_ = this.onRoomIdInput_.bind(this);
  this.roomIdInput_.addEventListener('input', this.roomIdInputListener_, false);

  this.roomIdKeyupListener_ = this.onRoomIdKeyPress_.bind(this);
  this.roomIdInput_.addEventListener('keyup', this.roomIdKeyupListener_, false);

  this.roomJoinButtonListener_ = this.onJoinButton_.bind(this);
  this.roomJoinButton_.addEventListener(
      'click', this.roomJoinButtonListener_, false);

  // Public callbacks. Keep it sorted.
  this.onRoomSelected = null;
};

RoomSelection.prototype.removeEventListeners = function() {
  this.roomIdInput_.removeEventListener('input', this.roomIdInputListener_);
  this.roomIdInput_.removeEventListener('keyup', this.roomIdKeyupListener_);
  this.roomJoinButton_.removeEventListener(
      'click', this.roomJoinButtonListener_);
};

RoomSelection.prototype.onRoomIdInput_ = function() {
  // Validate room id, enable/disable join button.
  // The server currently accepts only the \w character class and
  // hyphen+underscor.
  var room = this.roomIdInput_.value;
  var valid = room.length >= 5;
  var re = /^([a-zA-Z0-9-_]+)+$/;
  valid = valid && re.exec(room);
  if (valid) {
    this.roomJoinButton_.disabled = false;
    this.roomIdInput_.classList.remove('invalid');
    this.roomIdInputLabel_.classList.add('hidden');
  } else {
    this.roomJoinButton_.disabled = true;
    this.roomIdInput_.classList.add('invalid');
    this.roomIdInputLabel_.classList.remove('hidden');
  }
};

RoomSelection.prototype.onRoomIdKeyPress_ = function(event) {
  if (event.which !== 13 || this.roomJoinButton_.disabled) {
    return;
  }
  this.onJoinButton_();
};

RoomSelection.prototype.onJoinButton_ = function() {
  if (this.onRoomSelected) {
    this.onRoomSelected(this.roomIdInput_.value);
  }
};
