/**
 * PILOT Extension: Alarms (временная версия с хардкодом credentials)
 */

Ext.define('Store.Alarms.Module', {
    extend: 'Ext.Component',

    alarmData: null,
    leftStore: null,
    rightStore: null,
    refreshTask: null,
    selectedAlarm: null,
    initialized: false,

    initModule: function () {
        var me = this;
        if (me.initialized) return;
        me.initialized = true;

        // Временно используем хардкод
        window.ALARMS_LOGIN = 'office@gkstolica.ru';
        window.ALARMS_PASSWORD = 'BmJBDF';

        me.realInit();
    },

    realInit: function () {
        var me = this;

        // Проверка (теперь всегда ок)
        if (!window.ALARMS_LOGIN || !window.ALARMS_PASSWORD) {
            Ext.log('Alarms: логин или пароль не заданы');
            return;
        }

        window.AlarmsModule = me;

        me.leftStore = Ext.create('Ext.data.Store', {
            fields: ['alarmName', 'displayName', 'count'],
            data: [
                { alarmName: 'EXT ТС в движении', displayName: 'ТС в движении', count: 0 },
                { alarmName: 'EXT Низкий уровень топлива', displayName: 'Низкий уровень топлива', count: 0 }
            ]
        });

        me.rightStore = Ext.create('Ext.data.Store', {
            fields: ['agentid', 'vehiclenumber', 'value', 'timestamp']
        });

        var navTab = Ext.create('Ext.grid.Panel', {
            title: 'Мониторинг неполадок',
            iconCls: 'fa fa-exclamation-triangle',
            iconAlign: 'top',
            store: me.leftStore,
            columns: [
                { text: 'Неполадка', dataIndex: 'displayName', flex: 2 },
                { text: 'Количество', dataIndex: 'count', flex: 1, align: 'center' }
            ],
            hideHeaders: false,
            listeners: {
                select: function (grid, record) {
                    me.selectedAlarm = record.get('alarmName');
                    me.updateRightPanel(me.selectedAlarm);
                }
            }
        });

        var mainPanel = Ext.create('Ext.grid.Panel', {
            title: 'Список транспортных средств',
            store: me.rightStore,
            columns: [
                { text: 'Госномер', dataIndex: 'vehiclenumber', flex: 2 },
                { text: 'Значение датчика', dataIndex: 'value', flex: 1 },
                { text: 'Время обновления', dataIndex: 'timestamp', flex: 2, xtype: 'datecolumn', format: 'd.m.Y H:i:s' }
            ]
        });

        navTab.map_frame = mainPanel;

        if (skeleton && skeleton.navigation && skeleton.mapframe) {
            skeleton.navigation.add(navTab);
            skeleton.mapframe.add(mainPanel);
            Ext.log('Alarms: панели добавлены');
        } else {
            Ext.log('Alarms: skeleton не доступен');
            return;
        }

        me.refreshTask = setInterval(function () {
            me.fetchUnits();
        }, 30000);

        me.fetchUnits();
    },

    fetchUnits: function () {
        var me = this;
        var auth = 'Basic ' + btoa(window.ALARMS_LOGIN + ':' + window.ALARMS_PASSWORD);

        Ext.Ajax.request({
            url: 'https://online.gkstolica.ru/api/api.php?cmd=list&node=5',
            method: 'GET',
            headers: { 'Authorization': auth },
            disableCaching: false,
            success: function (response) {
                var data;
                try {
                    data = Ext.decode(response.responseText);
                } catch (e) {
                    Ext.log('Alarms: ошибка парсинга ответа');
                    return;
                }
                if (data.code !== 0 || !data.list) {
                    Ext.log('Alarms: API вернул ошибку или пустой список');
                    return;
                }
                me.processUnits(data.list);
            },
            failure: function (response) {
                if (response.status === 401) {
                    Ext.log('Alarms: ошибка авторизации (401) – проверьте логин/пароль');
                } else {
                    Ext.log('Alarms: ошибка запроса к API, статус: ' + response.status);
                }
            }
        });
    },

    processUnits: function (units) {
        var me = this;
        var newAlarmData = {
            'EXT ТС в движении': { count: 0, vehicles: [] },
            'EXT Низкий уровень топлива': { count: 0, vehicles: [] }
        };

        Ext.Array.forEach(units, function (unit) {
            var agentid = unit.agentid;
            var vehiclenumber = unit.vehiclenumber || 'Без номера';
            var sensorsStatus = unit.sensors_status || [];

            Ext.Array.forEach(sensorsStatus, function (sensor) {
                var sensorName = sensor.name || '';
                if (sensorName.indexOf('EXT') === 0 && newAlarmData.hasOwnProperty(sensorName)) {
                    var value = sensor.hum_value || '';
                    // ВНИМАНИЕ: условие активности неполадки (вкл.)
                    if (value === 'вкл.') {
                        var timestamp = sensor.change_ts ? parseInt(sensor.change_ts, 10) * 1000 : null;
                        newAlarmData[sensorName].count++;
                        newAlarmData[sensorName].vehicles.push({
                            agentid: agentid,
                            vehiclenumber: vehiclenumber,
                            value: value,
                            timestamp: timestamp
                        });
                    }
                }
            });
        });

        me.alarmData = newAlarmData;

        me.leftStore.each(function (record) {
            var alarmName = record.get('alarmName');
            var count = newAlarmData[alarmName] ? newAlarmData[alarmName].count : 0;
            record.set('count', count);
        });
        me.leftStore.commitChanges();

        if (me.selectedAlarm) {
            me.updateRightPanel(me.selectedAlarm);
        }
    },

    updateRightPanel: function (alarmName) {
        var me = this;
        me.rightStore.removeAll();
        if (me.alarmData && me.alarmData[alarmName]) {
            me.rightStore.loadData(me.alarmData[alarmName].vehicles || []);
        }
        var mainPanel = me.getMainPanel();
        if (mainPanel) {
            var displayName = (alarmName === 'EXT ТС в движении') ? 'ТС в движении' : 'Низкий уровень топлива';
            mainPanel.setTitle('Список ТС: ' + displayName);
        }
    },

    getMainPanel: function () {
        var me = this;
        if (!me.navTab) {
            var items = skeleton.navigation.items;
            for (var i = 0; i < items.length; i++) {
                if (items[i].title === 'Мониторинг неполадок') {
                    me.navTab = items[i];
                    break;
                }
            }
        }
        return me.navTab ? me.navTab.map_frame : null;
    },

    destroy: function () {
        var me = this;
        if (me.refreshTask) {
            clearInterval(me.refreshTask);
            me.refreshTask = null;
        }
        me.callParent();
    }
});