export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type UpliftRole =
  | 'community_member'
  | 'educator'
  | 'provider'
  | 'entrepreneur'
  | 'legal_advocate'
  | 'organizer'
  | 'admin'
  | 'municipal_partner';

export type PostType =
  | 'story'
  | 'mutual_aid_request'
  | 'mutual_aid_offer'
  | 'event'
  | 'announcement';

export type UpliftModule =
  | 'learn'
  | 'health'
  | 'wealth'
  | 'ventures'
  | 'justice'
  | 'community';

export type PostStatus = 'active' | 'fulfilled' | 'closed' | 'draft';

export type Profile = {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  short_bio: string | null;
  role: UpliftRole;
  modules: UpliftModule[];
  location_city: string | null;
  location_state: string | null;
  created_at: string;
  updated_at: string;
};

export type Post = {
  id: string;
  author_id: string;
  type: PostType;
  module: UpliftModule | null;
  title: string;
  body: string;
  tags: string[];
  status: PostStatus;
  location_geohash: string | null;
  created_at: string;
  updated_at: string;
  author?: Profile;
  reaction_count?: number;
  user_reacted?: boolean;
  comment_count?: number;
  embedding?: number[] | null;
};

export type PostReaction = {
  id: string;
  post_id: string;
  user_id: string;
  reaction_type: 'uplift' | 'can_help' | 'solidarity';
  created_at: string;
};

export type Follow = {
  follower_id: string;
  followed_id: string;
  created_at: string;
};

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: { id: string; username: string } & Partial<Omit<Profile, 'id' | 'username'>>;
        Update: Partial<Omit<Profile, 'id'>>;
        Relationships: [];
      };
      posts: {
        Row: Post;
        Insert: {
          author_id: string;
          type: PostType;
          title: string;
          body: string;
          module?: UpliftModule | null;
          tags?: string[];
          status?: PostStatus;
          location_geohash?: string | null;
        };
        Update: {
          type?: PostType;
          title?: string;
          body?: string;
          module?: UpliftModule | null;
          tags?: string[];
          status?: PostStatus;
          location_geohash?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'posts_author_id_fkey';
            columns: ['author_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          }
        ];
      };
      post_reactions: {
        Row: PostReaction;
        Insert: {
          post_id: string;
          user_id: string;
          reaction_type: 'uplift' | 'can_help' | 'solidarity';
        };
        Update: {
          reaction_type?: 'uplift' | 'can_help' | 'solidarity';
        };
        Relationships: [
          {
            foreignKeyName: 'post_reactions_post_id_fkey';
            columns: ['post_id'];
            isOneToOne: false;
            referencedRelation: 'posts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'post_reactions_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          }
        ];
      };
      follows: {
        Row: Follow;
        Insert: {
          follower_id: string;
          followed_id: string;
        };
        Update: Record<string, never>;
        Relationships: [
          {
            foreignKeyName: 'follows_follower_id_fkey';
            columns: ['follower_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'follows_followed_id_fkey';
            columns: ['followed_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          }
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      match_posts: {
        Args: {
          query_embedding: number[];
          match_threshold: number;
          match_count: number;
        };
        Returns: {
          id: string;
          title: string;
          body: string;
          type: PostType;
          module: UpliftModule | null;
          created_at: string;
          similarity: number;
        }[];
      };
      match_listings: {
        Args: {
          query_embedding: number[];
          match_threshold: number;
          match_count: number;
        };
        Returns: {
          id: string;
          name: string;
          description: string;
          category: string | null;
          location_city: string | null;
          location_state: string | null;
          similarity: number;
        }[];
      };
      match_news: {
        Args: {
          query_embedding: number[];
          match_threshold: number;
          match_count: number;
        };
        Returns: {
          id: string;
          title: string;
          description: string | null;
          url: string;
          published_at: string;
          source_name: string | null;
          black_impact: string | null;
          impact_sectors: string[] | null;
          similarity: number;
        }[];
      };
    };
    Enums: Record<string, never>;
  };
};
