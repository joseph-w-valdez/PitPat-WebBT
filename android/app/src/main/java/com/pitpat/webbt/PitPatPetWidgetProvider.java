package com.pitpat.webbt;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.widget.RemoteViews;

public class PitPatPetWidgetProvider extends AppWidgetProvider {
    private static final String ACTION = "com.pitpat.webbt.PET_WIDGET";
    private static final String ACTION_NUDGE = "com.pitpat.webbt.PET_NUDGE";
    private static final String PREFS = "pitpat_pet";
    private static final String KEY_INDEX = "index";
    private static final String KEY_MET = "met";
    private static final String KEY_ROTATION = "rotation";
    private static final String KEY_CAT = "cat";
    private static final String KEY_CAT_AT = "cat_at";
    private static final long HOUR_MS = 60L * 60L * 1000L;
    private static final String[] CATS = {
            "cat-1", "cat-2", "cat-3", "cat-4", "cat-5",
            "cat-6", "cat-7", "cat-8", "cat-9",
            "extra-bulba", "extra-sage"
    };
    private static final String[] ENCOURAGE = {
            "A little more and today is yours.",
            "Those miles are still waiting.",
            "One more walk. You have got this.",
            "The belt misses you.",
            "Today is not done yet.",
            "Small steps still count.",
            "You are close enough to try.",
            "Lace up. There is still time."
    };
    private static final String[] CONGRATS = {
            "Goal met. Look at you.",
            "That is the walk. Well done.",
            "Today is complete.",
            "Miles in the bag.",
            "You showed up. That is the win.",
            "Goal crushed. Rest those feet.",
            "Green day. Nice work.",
            "You did the thing."
    };

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) {
            super.onReceive(context, intent);
            return;
        }
        if (ACTION.equals(intent.getAction())) {
            final PendingResult pending = goAsync();
            advance(context);
            shake(context);
            new Handler(Looper.getMainLooper()).postDelayed(pending::finish, 400);
            return;
        }
        if (ACTION_NUDGE.equals(intent.getAction())) {
            final PendingResult pending = goAsync();
            rollCat(context, false);
            shake(context);
            scheduleNudge(context);
            new Handler(Looper.getMainLooper()).postDelayed(pending::finish, 400);
            return;
        }
        super.onReceive(context, intent);
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] appWidgetIds) {
        rollCat(context, false);
        scheduleNudge(context);
        for (int id : appWidgetIds) updateWidget(context, manager, id);
    }

    @Override
    public void onEnabled(Context context) {
        scheduleNudge(context);
    }

    @Override
    public void onDisabled(Context context) {
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms != null) alarms.cancel(nudgeIntent(context));
    }

    static void refresh(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, PitPatPetWidgetProvider.class));
        for (int id : ids) updateWidget(context, manager, id);
    }

    static String rollCat(Context context, boolean forceNew) {
        SharedPreferences prefs = prefs(context);
        String current = prefs.getString(KEY_CAT, "");
        long at = prefs.getLong(KEY_CAT_AT, 0L);
        long now = System.currentTimeMillis();
        if (!forceNew && isKnownCat(current) && now - at < HOUR_MS) return current;
        String next = CATS[(int) (Math.random() * CATS.length)];
        int guard = 0;
        while (next.equals(current) && guard < 8) {
            next = CATS[(int) (Math.random() * CATS.length)];
            guard += 1;
        }
        prefs.edit().putString(KEY_CAT, next).putLong(KEY_CAT_AT, now).apply();
        return next;
    }

    static void shake(Context context) {
        Handler handler = new Handler(Looper.getMainLooper());
        setRotation(context, -14f);
        handler.postDelayed(() -> setRotation(context, 12f), 140);
        handler.postDelayed(() -> setRotation(context, 0f), 320);
    }

    private static void advance(Context context) {
        SharedPreferences prefs = prefs(context);
        boolean met = goalMet(context);
        String[] pool = met ? CONGRATS : ENCOURAGE;
        int index = (prefs.getInt(KEY_INDEX, 0) + 1) % pool.length;
        prefs.edit().putInt(KEY_INDEX, index).putBoolean(KEY_MET, met).apply();
    }

    private static void setRotation(Context context, float rotation) {
        prefs(context).edit().putFloat(KEY_ROTATION, rotation).apply();
        refresh(context);
    }

    private static void scheduleNudge(Context context) {
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms == null) return;
        long delay = 90_000L + (long) (Math.random() * 150_000L);
        alarms.set(AlarmManager.ELAPSED_REALTIME, SystemClock.elapsedRealtime() + delay, nudgeIntent(context));
    }

    private static PendingIntent nudgeIntent(Context context) {
        Intent intent = new Intent(context, PitPatPetWidgetProvider.class);
        intent.setAction(ACTION_NUDGE);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getBroadcast(context, 302, intent, flags);
    }

    private static boolean goalMet(Context context) {
        return context.getSharedPreferences("pitpat_widget", Context.MODE_PRIVATE).getInt("goal", 0) >= 1000;
    }

    private static boolean isKnownCat(String cat) {
        for (String known : CATS) {
            if (known.equals(cat)) return true;
        }
        return false;
    }

    private static int drawableFor(String cat) {
        if ("cat-1".equals(cat)) return R.drawable.pet_cat_1;
        if ("cat-2".equals(cat)) return R.drawable.pet_cat_2;
        if ("cat-3".equals(cat)) return R.drawable.pet_cat_3;
        if ("cat-4".equals(cat)) return R.drawable.pet_cat_4;
        if ("cat-5".equals(cat)) return R.drawable.pet_cat_5;
        if ("cat-6".equals(cat)) return R.drawable.pet_cat_6;
        if ("cat-7".equals(cat)) return R.drawable.pet_cat_7;
        if ("cat-8".equals(cat)) return R.drawable.pet_cat_8;
        if ("cat-9".equals(cat)) return R.drawable.pet_cat_9;
        if ("extra-sage".equals(cat)) return R.drawable.pet_sage;
        return R.drawable.pet_bulba;
    }

    private static void updateWidget(Context context, AppWidgetManager manager, int appWidgetId) {
        try {
            SharedPreferences prefs = prefs(context);
            boolean met = goalMet(context);
            if (met != prefs.getBoolean(KEY_MET, false)) {
                prefs.edit().putBoolean(KEY_MET, met).putInt(KEY_INDEX, 0).apply();
            }
            String[] pool = met ? CONGRATS : ENCOURAGE;
            int index = Math.floorMod(prefs.getInt(KEY_INDEX, 0), pool.length);
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_pet);
            views.setTextViewText(R.id.petQuote, pool[index]);
            views.setTextColor(R.id.petQuote, met ? 0xFF3DDC84 : 0xFFF4F7FB);
            views.setImageViewResource(R.id.petImage, drawableFor(prefs.getString(KEY_CAT, "extra-bulba")));
            if (android.os.Build.VERSION.SDK_INT >= 31) {
                views.setFloat(R.id.petImage, "setRotation", prefs.getFloat(KEY_ROTATION, 0f));
            }
            Intent intent = new Intent(context, PitPatPetWidgetProvider.class);
            intent.setAction(ACTION);
            intent.setData(Uri.parse("pitpat://pet/shake"));
            int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
            views.setOnClickPendingIntent(R.id.petRoot, PendingIntent.getBroadcast(context, 301, intent, flags));
            manager.updateAppWidget(appWidgetId, views);
        } catch (Exception ignored) {
        }
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
