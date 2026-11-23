#!/usr/bin/env python3
"""Answers a native (GTK) message box of Gilgamesh through AT-SPI, as a user would:
waits for it, prints its text as JSON, clicks the button with the given label.

Usage: answer-dialog.py LABEL[,LABEL...] [TIMEOUT_SECONDS]
       answer-dialog.py --list      (prints the accessible tree of the app)
"""
import json
import sys
import time

import gi

gi.require_version("Atspi", "2.0")
from gi.repository import Atspi  # noqa: E402

DIALOG_ROLES = {Atspi.Role.DIALOG, Atspi.Role.ALERT, Atspi.Role.FILE_CHOOSER}


def apps():
    desktop = Atspi.get_desktop(0)
    for i in range(desktop.get_child_count()):
        app = desktop.get_child_at_index(i)
        if app is not None:
            yield app


def walk(node, depth=0, limit=12):
    if node is None or depth > limit:
        return
    yield node, depth
    try:
        count = node.get_child_count()
    except Exception:
        return
    for i in range(count):
        try:
            child = node.get_child_at_index(i)
        except Exception:
            continue
        yield from walk(child, depth + 1, limit)


def is_ours(app):
    name = (app.get_name() or "").lower()
    return "gilgamesh" in name


def find_dialog():
    for app in apps():
        if not is_ours(app):
            continue
        for i in range(app.get_child_count()):
            win = app.get_child_at_index(i)
            if win is not None and win.get_role() in DIALOG_ROLES:
                return win
    return None


def texts(dialog):
    out = []
    for node, _ in walk(dialog):
        if node.get_role() in (Atspi.Role.LABEL, Atspi.Role.TEXT):
            name = node.get_name()
            if name:
                out.append(name)
    return out


def main():
    if sys.argv[1] == "--list":
        for app in apps():
            print("APP", repr(app.get_name()))
            if is_ours(app):
                for node, depth in walk(app, limit=4):
                    print("  " * depth, node.get_role_name(), repr(node.get_name()))
        return
    labels = sys.argv[1].split(",")
    timeout = float(sys.argv[2]) if len(sys.argv) > 2 else 60
    end = time.time() + timeout
    while time.time() < end:
        dialog = find_dialog()
        if dialog is not None:
            buttons = [n for n, _ in walk(dialog) if n.get_role() == Atspi.Role.PUSH_BUTTON]
            names = [b.get_name() for b in buttons]
            for label in labels:
                for button in buttons:
                    if (button.get_name() or "").replace("_", "") == label:
                        info = {"title": dialog.get_name(), "text": texts(dialog), "buttons": names, "clicked": label}
                        Atspi.Action.do_action(button, 0)
                        print(json.dumps(info))
                        return
            print(json.dumps({"title": dialog.get_name(), "text": texts(dialog), "buttons": names, "clicked": None}))
            sys.exit(3)
        time.sleep(0.3)
    print(json.dumps({"error": "no dialog"}))
    sys.exit(2)


main()
