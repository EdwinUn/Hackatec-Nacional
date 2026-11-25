from app.adapters.inbound.iot_payload import IotTelemetryIn


def test_flexible_packet_maps_to_channels_and_device_state():
    pkt = IotTelemetryIn.model_validate(
        {
            "device_id": "B-01", "ph": 6.9, "turbidity": "180", "temperature": 22.4, "dissolved_oxygen": 5.8,
            "flow_rate": 12.5, "river_speed_ms": 0.9, "basket_fill_pct": 140, "battery_pct": 78, "rssi": -61,
            "firmware": "v2", "nuevo_campo": 1,
        }
    )  # fmt: skip
    data = pkt.to_input()
    assert data.values == {"ph": 6.9, "turb_in_ntu": 180.0, "temp_c": 22.4, "do_mgl": 5.8}
    assert (data.flow_rate_lpm, data.river_speed_ms, data.battery_pct, data.rssi_dbm) == (12.5, 0.9, 78, -61)
    assert data.basket_fill_pct == 100  # se recorta a 0–100


def test_a_bad_sensor_value_is_dropped_not_fatal():
    pkt = IotTelemetryIn.model_validate(
        {"device_id": "B-01", "ph": "NaN?", "turbidity": None, "rssi": "x", "ts": "ayer"}
    )
    data = pkt.to_input()
    assert data.values == {} and data.rssi_dbm is None and data.ts is None
