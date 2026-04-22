-- =============================================
--  InvenVision Database Schema
--  Run this once after MySQL is installed:
--  mysql -u root -p < schema.sql
-- =============================================

CREATE DATABASE IF NOT EXISTS invenvision
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE invenvision;

-- Users table (populated on first Google login)
CREATE TABLE IF NOT EXISTS users (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    email       VARCHAR(255) NOT NULL UNIQUE,
    name        VARCHAR(255),
    picture     VARCHAR(512),
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Inventory table (one row per user+item)
CREATE TABLE IF NOT EXISTS inventory (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    user_email      VARCHAR(255) NOT NULL,
    item_name       VARCHAR(255) NOT NULL,
    current_stock   FLOAT DEFAULT 0,
    reorder_point   FLOAT DEFAULT 0,
    next_week       FLOAT DEFAULT 0,
    next_month      FLOAT DEFAULT 0,
    days_left       INT DEFAULT 0,
    status          VARCHAR(20) DEFAULT 'ok',
    updated_date    VARCHAR(50),
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_user_item (user_email, item_name),
    INDEX idx_user_email (user_email)
);

-- Prediction history table
CREATE TABLE IF NOT EXISTS prediction_history (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    user_email      VARCHAR(255) NOT NULL,
    item_name       VARCHAR(255) NOT NULL,
    model           VARCHAR(50),
    auto_selected   VARCHAR(50),
    next_day        FLOAT,
    next_week       FLOAT,
    next_month      FLOAT,
    status          VARCHAR(20),
    sales_count     INT,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user_history (user_email),
    INDEX idx_created (created_at)
);
