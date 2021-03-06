import argparse
import asyncio
import logging
import os
import random

import cv2
from av import VideoFrame

from aiortc import (
    RTCIceCandidate,
    RTCPeerConnection,
    RTCSessionDescription,
    VideoStreamTrack,
)
from aiortc.contrib.media import MediaBlackhole, MediaPlayer
from aiortc.contrib.signaling import BYE, ApprtcSignaling

ROOT = os.path.dirname(__file__)
PHOTO_PATH = os.path.join(ROOT, "photo.jpg")


class VideoImageTrack(VideoStreamTrack):
    """
    A video stream track that returns a rotating image.
    """

    def __init__(self):
        super().__init__()  # don't forget this!
        self.img = cv2.imread(PHOTO_PATH, cv2.IMREAD_COLOR)

    async def recv(self):
        pts, time_base = await self.next_timestamp()

        # rotate image
        rows, cols, _ = self.img.shape
        M = cv2.getRotationMatrix2D((cols / 2, rows / 2), int(pts * time_base * 45), 1)
        img = cv2.warpAffine(self.img, M, (cols, rows))

        # create video frame
        frame = VideoFrame.from_ndarray(img, format="bgr24")
        frame.pts = pts
        frame.time_base = time_base

        return frame
    
class PiCameraTrack(VideoStreamTrack):
    def __init__(self):
        super().__init__()
        from picamera.array import PiRGBArray
        from picamera import PiCamera
        
        self.camera = PiCamera()
        self.rawCapture = PiRGBArray(self.camera)

    async def recv(self):
        pts, time_base = await self.next_timestamp()

        self.camera.capture(self.rawCapture, format="bgr")
        img = self.rawCapture.array

        # create video frame
        frame = VideoFrame.from_ndarray(img, format="bgr24")
        frame.pts = pts
        frame.time_base = time_base
        
        self.rawCapture.truncate(0)

        return frame


async def run(pc, player, signaling):
    def add_tracks():
        if player and player.audio:
            pc.addTrack(player.audio)

        if player and player.video:
            pc.addTrack(player.video)
        else:
            try:
                pc.addTrack(PiCameraTrack())
            except:
                print("Cannot open picamera")
                pc.addTrack(VideoImageTrack())

    @pc.on("track")
    def on_track(track):
        print("Track %s received" % track.kind)

    channel = pc.createDataChannel("control", maxRetransmits=0, ordered=False)

    @channel.on("open")
    def on_open():
        print('Data channel open')

    @channel.on("message")
    def on_message(message):
        if isinstance(message, str):
            print(message)
        else:
            print('Not string ', str(message))

    @channel.on("close")
    def on_close():
        print('Data channel closed')

    # connect to websocket and join
    params = await signaling.connect()

    if params["is_initiator"] == "true":
        # send offer
        print('I am the initiator')
        add_tracks()
        await pc.setLocalDescription(await pc.createOffer())
        await signaling.send(pc.localDescription)

    # consume signaling
    while True:
        obj = await signaling.receive()

        if isinstance(obj, RTCSessionDescription):
            await pc.setRemoteDescription(obj)

            if obj.type == "offer":
                # send answer
                add_tracks()
                await pc.setLocalDescription(await pc.createAnswer())
                await signaling.send(pc.localDescription)
        elif isinstance(obj, RTCIceCandidate):
            await pc.addIceCandidate(obj)
        elif obj is BYE:
            print("BYE")
            break


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="AppRTC")
    parser.add_argument("room", nargs="?")
    parser.add_argument("--play-from", help="Read the media from a file and sent it."),
    parser.add_argument("--verbose", "-v", action="count")
    args = parser.parse_args()

    if not args.room:
        args.room = "".join([random.choice("0123456789") for x in range(10)])

    if args.verbose:
        logging.basicConfig(level=logging.DEBUG)

    # create signaling and peer connection
    signaling = ApprtcSignaling(args.room)
    signaling._origin = "http://192.168.1.101:8080"
    pc = RTCPeerConnection()

    # create media source
    if args.play_from:
        player = MediaPlayer(args.play_from)
    else:
        player = None

    # run event loop
    loop = asyncio.get_event_loop()
    try:
        loop.run_until_complete(
            run(pc=pc, player=player, signaling=signaling)
        )
    except KeyboardInterrupt:
        pass
    finally:
        # cleanup
        loop.run_until_complete(signaling.close())
        loop.run_until_complete(pc.close())
