package com.pitpat.webbt;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.ColorStateList;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public class PitPatStatsWidgetProvider extends AppWidgetProvider {
    static final String EXTRA_MONTH = "stats_month";
    private static final String ACTION = "com.pitpat.webbt.STATS_WIDGET";
    private static final String EXTRA_ACTION = "stats_action";
    private static final String PREFS = "pitpat_stats";
    private static final String KEY_SNAPSHOT = "snapshot";
    private static final String KEY_VIEW = "view";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent != null && ACTION.equals(intent.getAction())) return;
        super.onReceive(context, intent);
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] appWidgetIds) {
        for (int id : appWidgetIds) updateWidget(context, manager, id);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int appWidgetId, Bundle options) {
        updateWidget(context, manager, appWidgetId);
    }

    static void saveSnapshot(Context context, String json) {
        try {
            prefs(context).edit().putString(KEY_SNAPSHOT, json == null ? "" : json).apply();
            refresh(context);
        } catch (Exception ignored) {
        }
    }

    private static void refresh(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, PitPatStatsWidgetProvider.class));
        for (int id : ids) updateWidget(context, manager, id);
    }

    private static void updateWidget(Context context, AppWidgetManager manager, int appWidgetId) {
        try {
            MonthCache cache = MonthCache.parse(prefs(context).getString(KEY_SNAPSHOT, ""), "week");
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_stats);
            views.setTextViewText(R.id.statsTitle, cache.title);
            views.setTextViewText(R.id.statsDistance, String.format(Locale.US, "%.2f / %.1f mi", cache.miles, cache.goal));
            int progress = cache.goal > 0 ? (int) Math.round(Math.min(1, cache.miles / cache.goal) * 1000) : 0;
            views.setProgressBar(R.id.weekGoal, 1000, progress, false);
            views.setTextColor(R.id.statsDistance, progress >= 1000 ? 0xFF3DDC84 : progress >= 500 ? 0xFFF5C451 : 0xFFF4F7FB);
            if (Build.VERSION.SDK_INT >= 31) {
                try {
                    int color = progress >= 1000 ? 0xFF3DDC84 : progress >= 500 ? 0xFFF5C451 : 0xFF3DD6C6;
                    views.setColorStateList(R.id.weekGoal, "setProgressTintList", ColorStateList.valueOf(color));
                } catch (RuntimeException ignored) {
                }
            }

            Bundle options = manager.getAppWidgetOptions(appWidgetId);
            int widthDp = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 250);
            int heightDp = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 250);
            float density = context.getResources().getDisplayMetrics().density;
            int chartW = Math.min(640, Math.max(1, Math.round((widthDp - 24) * density)));
            int chartH = Math.min(240, Math.max(1, Math.round(Math.max(90, heightDp * 0.46f) * density)));
            views.setImageViewBitmap(R.id.statsChart, drawChart(cache.bars, chartW, chartH, density));
            manager.updateAppWidget(appWidgetId, views);
        } catch (Exception ignored) {
        }
    }

    private static void bindTab(RemoteViews views, Context context, int id, String view, String selected, int requestCode) {
        boolean on = view.equals(selected);
        views.setInt(id, "setBackgroundResource", on ? R.drawable.widget_tab_on : R.drawable.widget_speed_button);
        views.setTextColor(id, on ? 0xFF12151C : 0xFF9AA6B8);
        Intent intent = new Intent(context, PitPatStatsWidgetProvider.class);
        intent.setAction(ACTION);
        intent.putExtra(EXTRA_ACTION, view);
        intent.setData(Uri.parse("pitpat://stats/" + view));
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        views.setOnClickPendingIntent(id, PendingIntent.getBroadcast(context, requestCode, intent, flags));
    }

    private static int barColor(String level, boolean selected) {
        if ("met".equals(level)) return selected ? 0xFF3DDC84 : 0xB33DDC84;
        if ("half".equals(level)) return selected ? 0xFFF5C451 : 0xB3F5C451;
        return selected ? 0xFFFF8B7A : 0x73FF8B7A;
    }

    private static int tipColor(String level) {
        if ("met".equals(level)) return 0xFF3DDC84;
        if ("half".equals(level)) return 0xFFF5C451;
        return 0xFFFF8B7A;
    }

    private static Bitmap drawChart(List<Bar> bars, int width, int height, float density) {
        Bitmap bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        paint.setTextAlign(Paint.Align.CENTER);
        if (bars.isEmpty()) {
            paint.setColor(0xFF9AA6B8);
            paint.setTextSize(13 * density);
            canvas.drawText("No walks", width / 2f, height / 2f, paint);
            return bitmap;
        }
        float labelH = 16 * density;
        float tipH = 18 * density;
        float plotBottom = height - labelH;
        float plotTop = tipH + 6 * density;
        float plotH = Math.max(1, plotBottom - plotTop);
        float max = 0.01f;
        for (Bar bar : bars) max = Math.max(max, (float) Math.max(bar.miles, bar.goal));
        float slot = width / (float) bars.size();
        paint.setColor(0x8CFF8B7A);
        paint.setStrokeWidth(Math.max(2, 2 * density));
        canvas.drawLine(0, plotBottom, width, plotBottom, paint);
        for (int i = 0; i < bars.size(); i++) {
            Bar bar = bars.get(i);
            float barH = bar.miles <= 0 ? 0 : Math.max(4 * density, (float) (bar.miles / max) * plotH);
            float left = i * slot + slot * 0.22f;
            float right = (i + 1) * slot - slot * 0.22f;
            float top = plotBottom - barH;
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(barColor(bar.level, bar.selected));
            float radius = Math.min(8 * density, Math.max(0, barH / 2f));
            Path barPath = new Path();
            barPath.addRoundRect(new RectF(left, top, right, plotBottom), new float[] {radius, radius, radius, radius, 0, 0, 0, 0}, Path.Direction.CW);
            canvas.drawPath(barPath, paint);
            paint.setTextSize(11 * density);
            paint.setColor(bar.selected ? 0xFFF4F7FB : 0xFF9AA6B8);
            canvas.drawText(bar.label, i * slot + slot / 2f, height - 2 * density, paint);
            if (bar.selected && bar.miles > 0) {
                String tip = String.format(Locale.US, "%.1f mi", bar.miles);
                paint.setTextSize(11 * density);
                float textW = paint.measureText(tip);
                float cx = i * slot + slot / 2f;
                float tipTop = Math.max(0, top - tipH - 4 * density);
                paint.setColor(tipColor(bar.level));
                canvas.drawRoundRect(new RectF(cx - textW / 2f - 6 * density, tipTop, cx + textW / 2f + 6 * density, tipTop + tipH), 8 * density, 8 * density, paint);
                paint.setColor("met".equals(bar.level) ? 0xFF06210F : "half".equals(bar.level) ? 0xFF2A2208 : 0xFF3A120E);
                canvas.drawText(tip, cx, tipTop + tipH - 5 * density, paint);
            }
        }
        return bitmap;
    }

    private static String clock(long seconds) {
        long h = seconds / 3600;
        long m = (seconds % 3600) / 60;
        long s = seconds % 60;
        return String.format(Locale.US, "%02d:%02d:%02d", h, m, s);
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static final class Bar {
        final String label;
        final boolean selected;
        final double miles;
        final double goal;
        final String level;

        Bar(String label, boolean selected, double miles, double goal, String level) {
            this.label = label;
            this.selected = selected;
            this.miles = miles;
            this.goal = goal;
            this.level = level == null ? "" : level;
        }
    }

    private static final class MonthCache {
        String title = "—";
        long seconds;
        double miles;
        double goal;
        double calories;
        int days;
        int sessions;
        final List<Bar> bars = new ArrayList<>();

        static MonthCache parse(String json, String view) {
            MonthCache cache = new MonthCache();
            if (json == null || json.isEmpty()) return cache;
            try {
                JSONObject root = new JSONObject(json);
                JSONObject period = root.optJSONObject(view);
                if (period == null) return cache;
                cache.title = period.optString("title", "—");
                cache.seconds = Math.round(period.optDouble("seconds"));
                cache.miles = period.optDouble("miles");
                cache.goal = period.optDouble("goal");
                cache.calories = period.optDouble("calories");
                cache.days = period.optInt("days");
                cache.sessions = period.optInt("sessions");
                JSONArray list = period.optJSONArray("bars");
                if (list == null) return cache;
                for (int i = 0; i < list.length(); i++) {
                    JSONObject item = list.optJSONObject(i);
                    if (item == null) continue;
                    cache.bars.add(new Bar(
                            item.optString("label", ""),
                            item.optBoolean("selected"),
                            item.optDouble("miles"),
                            item.optDouble("goal"),
                            item.optString("level", "")));
                }
            } catch (Exception ignored) {
            }
            return cache;
        }
    }
}
