package com.pitpat.webbt;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

public class WalkService extends Service {
    static final String ACTION_DO = "com.pitpat.webbt.WALK_DO";
    private static final String CHANNEL = "walk";
    private static final int NOTE_ID = 7;
    private static WalkService running;
    private String shownTitle = "Walking";
    private String shownBody = "";
    private String shownAction = "";

    static void show(Context context, String title, String body, String action) {
        WalkService current = running;
        if (current != null) {
            current.post(title, body, action);
            return;
        }
        Intent intent = new Intent(context, WalkService.class);
        intent.putExtra("title", title);
        intent.putExtra("body", body);
        intent.putExtra("action", action);
        try {
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent);
            else context.startService(intent);
        } catch (RuntimeException ignored) {
        }
    }

    static void stop(Context context) {
        context.stopService(new Intent(context, WalkService.class));
    }

    @Override
    public void onCreate() {
        super.onCreate();
        running = this;
        ensureChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_DO.equals(intent.getAction())) {
            String action = intent.getStringExtra("action");
            Notification note = build(shownTitle, shownBody, shownAction);
            enterForeground(note);
            if ("pause".equals(action) || "resume".equals(action)) {
                MainActivity.runInBackground(action);
            }
            return START_NOT_STICKY;
        }
        shownTitle = intent == null ? "Walking" : intent.getStringExtra("title");
        shownBody = intent == null ? "" : intent.getStringExtra("body");
        shownAction = intent == null ? "" : intent.getStringExtra("action");
        enterForeground(build(shownTitle, shownBody, shownAction));
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        if (running == this) running = null;
        stopForeground(STOP_FOREGROUND_REMOVE);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void post(String title, String body, String action) {
        shownTitle = title;
        shownBody = body;
        shownAction = action;
        Notification note = build(title, body, action);
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) manager.notify(NOTE_ID, note);
    }

    private void enterForeground(Notification note) {
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                startForeground(NOTE_ID, note, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE);
            } else {
                startForeground(NOTE_ID, note);
            }
        } catch (RuntimeException err) {
            stopSelf();
        }
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL, getString(R.string.walk_channel), NotificationManager.IMPORTANCE_LOW);
        channel.setSound(null, null);
        channel.enableVibration(false);
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) manager.createNotificationChannel(channel);
    }

    private Notification build(String title, String body, String action) {
        if (title == null || title.isEmpty()) title = "Walking";
        if (body == null) body = "";
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        PendingIntent content = PendingIntent.getActivity(this, 8, open, flags);
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(this, CHANNEL)
                : new Notification.Builder(this);
        builder.setSmallIcon(android.R.drawable.ic_media_play)
                .setContentTitle(title)
                .setContentText(body)
                .setContentIntent(content)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setCategory(Notification.CATEGORY_PROGRESS);
        if ("pause".equals(action) || "resume".equals(action)) {
            Intent act = new Intent(this, WalkService.class);
            act.setAction(ACTION_DO);
            act.putExtra("action", action);
            PendingIntent pending = PendingIntent.getService(this, 9, act, flags);
            String label = "pause".equals(action) ? getString(R.string.walk_pause) : getString(R.string.walk_resume);
            int icon = "pause".equals(action) ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play;
            builder.addAction(new Notification.Action.Builder(icon, label, pending).build());
        }
        return builder.build();
    }
}
