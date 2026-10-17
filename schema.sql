-- MySQL Database Schema for Multi-User Novel Reader
-- Execute this script in your MySQL database: mysql -u root -p < schema.sql

CREATE DATABASE IF NOT EXISTS novel_reader DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE novel_reader;

-- 1. 用户表 (Users) - 包含角色权限与单设备绑定管理
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(64) UNIQUE NOT NULL COMMENT '登录用户名',
  password VARCHAR(255) NOT NULL COMMENT '密码哈希 (bcrypt)',
  nickname VARCHAR(64) DEFAULT NULL COMMENT '用户昵称',
  role VARCHAR(16) DEFAULT 'user' COMMENT '用户角色: admin 或 user',
  bound_device_id VARCHAR(128) DEFAULT NULL COMMENT '绑定的单设备标识',
  device_info VARCHAR(255) DEFAULT NULL COMMENT '设备环境/型号信息',
  device_bound_at TIMESTAMP NULL DEFAULT NULL COMMENT '设备绑定时间',
  device_reset_requested TINYINT(1) DEFAULT 0 COMMENT '是否申请更换设备: 1-申请中, 0-正常',
  status VARCHAR(16) DEFAULT 'active' COMMENT '状态: active 或 disabled',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '注册时间'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. 用户-小说关联表 (User Novels Association)
-- 多用户共享统一小说目录 (novels/)，通过此表记录用户的下载、收藏、阅读关联与书架状态
CREATE TABLE IF NOT EXISTS user_novels (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL COMMENT '用户ID',
  novel_filename VARCHAR(255) NOT NULL COMMENT '小说文件名 (含.txt)',
  custom_name VARCHAR(255) DEFAULT NULL COMMENT '用户自定义书名',
  is_favorite TINYINT(1) DEFAULT 0 COMMENT '是否收藏: 1-已收藏, 0-普通书架',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '关联时间',
  UNIQUE KEY uk_user_novel (user_id, novel_filename),
  INDEX idx_user_id (user_id),
  INDEX idx_filename (novel_filename),
  CONSTRAINT fk_user_novels_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 初始化默认管理员账号 (账号: admin，初始密码: 123456)
INSERT IGNORE INTO users (id, username, password, nickname, role, status) VALUES 
(1, 'admin', '$2b$10$t41IeJ..vtQgdSqdUnPQGuztOYeTndqdqDW17O8Wk9OpWgcO8QdOy', '超级管理员', 'admin', 'active');
