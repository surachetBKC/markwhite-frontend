// *** static/sw.js ***

self.addEventListener('push', function(event) {
    if (event.data) {
        const data = event.data.json();

        const options = {
            body: data.body,
            icon: '/static/images/mw_mini_w4.png', // รูปไอคอน App คุณ
            badge: '/static/images/mw_mini_w3.ico', // รูปเล็กๆ บน Status bar (Android)
            vibrate: [100, 50, 100],
            data: {
                dateOfArrival: Date.now(),
                primaryKey: 1,
                url: data.url || '/' // ลิงก์ที่จะไปเมื่อกด
            },
            actions: [
                {action: 'view', title: 'ดูรายงาน'},
                {action: 'close', title: 'ปิด'}
            ]
        };

        event.waitUntil(
            self.registration.showNotification(data.title, options)
        );
    }
});

self.addEventListener('notificationclick', function(event) {
    event.notification.close();

    if (event.action === 'view' || !event.action) {
        // เมื่อกดที่แจ้งเตือน ให้เปิดหน้าเว็บรายงาน
        event.waitUntil(
            clients.openWindow(event.notification.data.url)
        );
    }
});
