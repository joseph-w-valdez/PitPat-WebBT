package com.pitpat.webbt;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.widget.RemoteViews;

public class PitPatWidgetProvider extends AppWidgetProvider {
    static final String EXTRA_WIDGET_ACTION = "widget_action";
    static final String EXTRA_BACKGROUND = "background";
    static final String ACTION_WIDGET_BUTTON = "com.pitpat.webbt.WIDGET_BUTTON";
    static final String ACTION_CONNECT = "connect";
    static final String ACTION_TOGGLE = "toggle";
    private static final String PREFS = "pitpat_widget";
    private static final String KEY_CONNECTED = "connected";
    private static final String KEY_RUNNING = "running";
    private static final String KEY_STATUS = "status";
    private static final String KEY_ADDRESS = "last_address";
    private static final String KEY_SPEED = "speed";
    private static final String KEY_TIME = "time";
    private static final String KEY_CALORIES = "calories";
    private static final String KEY_DISTANCE = "distance";
    private static final String KEY_PRESET = "preset";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent != null && ACTION_WIDGET_BUTTON.equals(intent.getAction())) {
            String action = intent.getStringExtra(EXTRA_WIDGET_ACTION);
            if (MainActivity.runInBackground(action)) return;
            Intent open = new Intent(context, MainActivity.class);
            open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            open.putExtra(EXTRA_WIDGET_ACTION, action);
            open.putExtra(EXTRA_BACKGROUND, true);
            context.startActivity(open);
            return;
        }
        super.onReceive(context, intent);
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            updateWidget(context, manager, appWidgetId);
        }
    }

    static void publish(Context context, boolean connected, boolean running, String status) {
        publish(context, connected, running, status, "-", "-", "-", "-", "");
    }

    static void publish(Context context, boolean connected, boolean running, String status,
            String speed, String time, String calories, String distance, String preset) {
        prefs(context).edit()
                .putBoolean(KEY_CONNECTED, connected)
                .putBoolean(KEY_RUNNING, running)
                .putString(KEY_STATUS, status == null ? "Disconnected" : status)
                .putString(KEY_SPEED, blank(speed))
                .putString(KEY_TIME, blank(time))
                .putString(KEY_CALORIES, blank(calories))
                .putString(KEY_DISTANCE, blank(distance))
                .putString(KEY_PRESET, preset == null ? "" : preset)
                .apply();
        refresh(context);
    }

    static void saveAddress(Context context, String address) {
        if (address == null || address.isEmpty()) return;
        prefs(context).edit().putString(KEY_ADDRESS, address).apply();
    }

    static String lastAddress(Context context) {
        return prefs(context).getString(KEY_ADDRESS, null);
    }

    private static void refresh(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, PitPatWidgetProvider.class));
        for (int id : ids) {
            updateWidget(context, manager, id);
        }
    }

    static void updateWidget(Context context, AppWidgetManager manager, int appWidgetId) {
        SharedPreferences prefs = prefs(context);
        boolean connected = prefs.getBoolean(KEY_CONNECTED, false);
        boolean running = prefs.getBoolean(KEY_RUNNING, false);
        String speed = prefs.getString(KEY_SPEED, "-");
        String time = prefs.getString(KEY_TIME, "-");
        String calories = prefs.getString(KEY_CALORIES, "-");
        String distance = prefs.getString(KEY_DISTANCE, "-");
        String preset = prefs.getString(KEY_PRESET, "");

        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_controls);
        views.setTextViewText(R.id.widgetSpeed, speed);
        views.setTextViewText(R.id.widgetTime, time);
        views.setTextViewText(R.id.widgetCalories, calories);
        views.setTextViewText(R.id.widgetDistance, distance);
        views.setTextViewText(R.id.widgetConnect, connected ? "Disconnect" : "Connect");
        views.setTextViewText(R.id.widgetStart, running ? "Pause" : "Start");
        views.setInt(R.id.widgetConnect, "setBackgroundResource",
                connected ? R.drawable.widget_speed_button : R.drawable.widget_connect_button);
        views.setTextColor(R.id.widgetConnect, Color.parseColor(connected ? "#F4F7FB" : "#06221F"));
        if (!connected) {
            views.setInt(R.id.widgetStart, "setBackgroundResource", R.drawable.widget_speed_button);
            views.setTextColor(R.id.widgetStart, Color.parseColor("#9AA6B8"));
        } else if (running) {
            views.setInt(R.id.widgetStart, "setBackgroundResource", R.drawable.widget_pause_button);
            views.setTextColor(R.id.widgetStart, Color.parseColor("#2A2208"));
        } else {
            views.setInt(R.id.widgetStart, "setBackgroundResource", R.drawable.widget_start_button);
            views.setTextColor(R.id.widgetStart, Color.parseColor("#06210F"));
        }
        views.setOnClickPendingIntent(R.id.widgetConnect, widgetAction(context, ACTION_CONNECT, 1));
        views.setOnClickPendingIntent(R.id.widgetStart, widgetAction(context, ACTION_TOGGLE, 2));
        bindPreset(views, context, R.id.preset15, "1.5", 15, preset);
        bindPreset(views, context, R.id.preset20, "2", 20, preset);
        bindPreset(views, context, R.id.preset25, "2.5", 25, preset);
        bindPreset(views, context, R.id.preset30, "3", 30, preset);
        manager.updateAppWidget(appWidgetId, views);
    }

    private static void bindPreset(RemoteViews views, Context context, int id, String label, int requestCode, String selected) {
        boolean on = false;
        try {
            if (selected != null && !selected.isEmpty()) {
                on = Math.abs(Float.parseFloat(selected) - Float.parseFloat(label)) < 0.05f;
            }
        } catch (NumberFormatException ignored) {
            on = false;
        }
        views.setInt(id, "setBackgroundResource", on ? R.drawable.widget_connect_button : R.drawable.widget_speed_button);
        views.setTextColor(id, Color.parseColor(on ? "#06221F" : "#F4F7FB"));
        views.setOnClickPendingIntent(id, widgetAction(context, label, requestCode));
    }

    private static String blank(String value) {
        return value == null || value.isEmpty() ? "-" : value;
    }

    private static PendingIntent widgetAction(Context context, String action, int requestCode) {
        Intent intent = new Intent(context, PitPatWidgetProvider.class);
        intent.setAction(ACTION_WIDGET_BUTTON);
        intent.putExtra(EXTRA_WIDGET_ACTION, action);
        intent.setData(Uri.parse("pitpat://widget/" + action));
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getBroadcast(context, requestCode, intent, flags);
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
